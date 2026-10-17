import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import type { EntityDraft, ServerDetailDraft } from '../src/core/draft.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import { argumentTokens, packageName, parseUvxArguments } from '../src/probe/local-targets.ts'
import { dummyEnv, hintsMcpSubcommand, launchAttempts, StdioRpc } from '../src/probe/sandbox.ts'
import { applyProbedTools, probeBelongs, probeKeys, repoRoot, type ProbedTools } from '../src/probe/tools-store.ts'

const detail = (over: Partial<ServerDetailDraft> = {}): ServerDetailDraft => ({ isRemote: false, transports: ['stdio'], packages: [], envVars: [], remotes: [], tools: [], ...over })

function server(over: Partial<ServerDetailDraft>, identity: { repo?: string; registryName?: string } = {}): EntityDraft {
  const b = new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: 'x', sourceUrl: 'https://mcp.so/server/x', slug: 'x', name: 'X' }, detail(over))
  b.identity({ repository: parseRepositoryUrl(identity.repo), registryName: identity.registryName })
  return b.build() as EntityDraft
}

const tools = [{ name: 'git_status', description: 'Shows the working tree status', inputSchema: { type: 'object', properties: { repo_path: { type: 'string' } }, required: ['repo_path'] } }]

describe('Registry 启动参数', () => {
  it('只取有固定值或默认值的参数，占位符换成临时目录', () => {
    expect(
      argumentTokens([
        { type: 'positional', value: 'serve' },
        { type: 'named', name: '--context', default: 'desktop-app' },
        { type: 'named', name: '--token', isRequired: true },
        { type: 'positional', valueHint: 'path' },
        { type: 'positional', value: '{project_dir}/data' },
      ]),
    ).toEqual(['serve', '--context', 'desktop-app', '/tmp/data'])
    expect(argumentTokens(null)).toEqual([])
  })

  it('uvx 参数：命令前是 uv 的选项，第一个位置参数起交给服务', () => {
    expect(parseUvxArguments(['-p', '3.13', 'start-mcp-server', '--project-from-cwd', '--context', 'desktop-app'])).toEqual({
      python: '3.13',
      withSpecs: [],
      args: ['start-mcp-server', '--project-from-cwd', '--context', 'desktop-app'],
    })
    expect(parseUvxArguments(['--from', 'pypreset[mcp]', '--with=httpx', '--refresh'])).toEqual({ installSpec: 'pypreset[mcp]', withSpecs: ['httpx'], args: [] })
  })

  it('包名去掉版本和 extras', () => {
    expect(packageName({ registryType: 'npm', identifier: '@acme/mcp@1.2.0' })).toBe('@acme/mcp')
    expect(packageName({ registryType: 'npm', identifier: 'meowfacts-mcp' })).toBe('meowfacts-mcp')
    expect(packageName({ registryType: 'pypi', identifier: 'awslabs.bedrock-kb-retrieval-mcp-server@latest' })).toBe('awslabs.bedrock-kb-retrieval-mcp-server')
    expect(packageName({ registryType: 'pypi', identifier: 'pypreset[mcp]==0.4.0' })).toBe('pypreset')
  })
})

describe('必填环境变量的假值', () => {
  it('按名字给像样的值，AWS_PROFILE 改给假密钥，非法名字跳过', () => {
    expect(dummyEnv(['JIRA_URL', 'API_TOKEN', 'AWS_PROFILE', 'FASTMCP_LOG_LEVEL', 'bad name'])).toEqual([
      '-e', 'JIRA_URL=https://example.com',
      '-e', 'API_TOKEN=dummy',
      '-e', 'AWS_ACCESS_KEY_ID=dummy', '-e', 'AWS_SECRET_ACCESS_KEY=dummy',
      '-e', 'FASTMCP_LOG_LEVEL=ERROR',
    ])
  })
})

describe('启动参数的尝试顺序', () => {
  it('先用登记的参数（去掉开头的入口名），失败再不带参数', () => {
    expect(launchAttempts(['basic-memory', 'mcp'], ['basic-memory', 'bm'])).toEqual([['mcp'], []])
    expect(launchAttempts(['8089'], ['mcp-server-commands'])).toEqual([['8089'], []])
    expect(launchAttempts([], ['x'])).toEqual([[]])
  })

  it('马上退出或提到 mcp 子命令时再试 mcp', () => {
    expect(hintsMcpSubcommand('exit 0')).toBe(true)
    expect(hintsMcpSubcommand("exit 1: Run 'xcodebuildmcp mcp' to start the MCP server.")).toBe(true)
    expect(hintsMcpSubcommand('exit 1: from mcp_servers.server import x')).toBe(false)
    expect(hintsMcpSubcommand('exit 10: boom')).toBe(false)
  })
})

describe('实测结果补给发布条目', () => {
  const probe = (over: Partial<ProbedTools> = {}): ProbedTools => ({ tools, probedAt: '2026-10-16T00:00:00.000Z', ...over })

  it('只给没有工具列表的服务算包键', () => {
    const pkgs = [
      { registryType: 'npm' as const, identifier: '@Acme/Weather@1.0.0' },
      { registryType: 'pypi' as const, identifier: 'Acme_Weather' },
      { registryType: 'oci' as const, identifier: 'acme/weather' },
    ]
    expect(probeKeys(server({ packages: pkgs }))).toEqual(['npm:@acme/weather', 'pypi:acme-weather'])
    expect(probeKeys(server({ packages: pkgs, tools: [{ name: 'a', params: [] }] }))).toEqual([])
  })

  it('包的仓库与条目一致（忽略子目录、大小写）才算属于这个条目', () => {
    const draft = server({}, { repo: 'https://github.com/Acme/mcp-servers/tree/main/weather' })
    expect(probeBelongs(draft, probe({ repository: 'git+https://github.com/acme/mcp-servers.git' }))).toBe(true)
    expect(probeBelongs(draft, probe({ repository: 'https://github.com/firecrawl/cli' }))).toBe(false)
    expect(probeBelongs(draft, probe({}))).toBe(false)
  })

  it('npm 的仓库简写也能识别', () => {
    expect(repoRoot('ChromeDevTools/chrome-devtools-mcp')).toBe('repo:github.com/chromedevtools/chrome-devtools-mcp')
    expect(repoRoot('gitlab:acme/weather')).toBe('repo:gitlab.com/acme/weather')
    expect(repoRoot('https://github.com/acme/mcp-servers/tree/main/weather')).toBe('repo:github.com/acme/mcp-servers')
  })

  it('包声明的 Registry 名称与条目一致也算', () => {
    const draft = server({}, { registryName: 'io.github.acme/weather' })
    expect(probeBelongs(draft, probe({ mcpName: 'io.github.Acme/weather' }))).toBe(true)
    expect(probeBelongs(draft, probe({ mcpName: 'io.github.other/weather' }))).toBe(false)
  })

  it('补上工具并展开参数；核对不通过的不补', () => {
    const draft = server({ packages: [{ registryType: 'pypi', identifier: 'mcp-server-git' }] }, { repo: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git' })
    const probes = new Map([['pypi:mcp-server-git', probe({ repository: 'https://github.com/modelcontextprotocol/servers' })]])
    expect(applyProbedTools(draft, probes)).toBe(true)
    expect(draft.kind === 'server' && draft.detail.tools[0]).toMatchObject({ name: 'git_status', params: [{ path: 'repo_path', jsonType: 'string', required: true }] })

    const other = server({ packages: [{ registryType: 'npm', identifier: 'firecrawl-cli' }] }, { repo: 'https://github.com/firecrawl/firecrawl' })
    expect(applyProbedTools(other, new Map([['npm:firecrawl-cli', probe({ repository: 'https://github.com/firecrawl/cli' })]]))).toBe(false)
    expect(other.kind === 'server' && other.detail.tools).toEqual([])
  })
})

describe('stdio JSON-RPC', () => {
  function fakeChild() {
    const emitter = new EventEmitter()
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(emitter, { stdin, stdout, stderr })
    return { child, stdin, stdout }
  }

  it('跳过日志行（收进 output），按 id 对应响应，分片到达也能拼起来', async () => {
    const { child, stdin, stdout } = fakeChild()
    const rpc = new StdioRpc(child)
    const sent: string[] = []
    stdin.on('data', (d: Buffer) => sent.push(d.toString()))
    const pending = rpc.request('initialize', {}, 1000)
    stdout.write('Server starting...\n{"jsonrpc":"2.0","id":1,"res')
    stdout.write('ult":{"serverInfo":{"name":"x"}}}\n')
    await expect(pending).resolves.toMatchObject({ id: 1, result: { serverInfo: { name: 'x' } } })
    expect(JSON.parse(sent.join(''))).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(rpc.output).toBe('Server starting...\n')
  })

  it('进程退出时等待中的请求立即失败', async () => {
    const { child } = fakeChild()
    const rpc = new StdioRpc(child)
    const pending = rpc.request('initialize', {}, 5000)
    child.emit('exit', 1)
    await expect(pending).rejects.toThrow('exited')
    expect(rpc.exitCode).toBe(1)
  })
})
