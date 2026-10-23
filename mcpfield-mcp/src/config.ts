/*
 * 生成某个 MCP 服务在指定客户端里的配置。启动方式与网站详情页一致（mcp-field/src/lib/config.ts）：
 * 远程服务给地址；本地服务按收录的安装包推出命令（npm → npx，pypi → uvx，oci → docker），环境变量给占位值。
 */

export const CLIENTS = ['claude-code', 'codex', 'gemini-cli', 'cursor', 'vscode', 'claude-desktop', 'windsurf'] as const
export type Client = (typeof CLIENTS)[number]

export const CLIENT_LABELS: Record<Client, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'gemini-cli': 'Gemini CLI',
  cursor: 'Cursor',
  vscode: 'VS Code',
  'claude-desktop': 'Claude Desktop',
  windsurf: 'Windsurf',
}

/** 配置写在哪里；claude-code 是在终端运行的命令 */
export const CLIENT_FILES: Record<Client, string> = {
  'claude-code': 'terminal',
  codex: '~/.codex/config.toml',
  'gemini-cli': '~/.gemini/settings.json (or .gemini/settings.json in a project)',
  cursor: '~/.cursor/mcp.json (or .cursor/mcp.json in a project)',
  vscode: '.vscode/mcp.json',
  'claude-desktop': 'claude_desktop_config.json',
  windsurf: '~/.codeium/windsurf/mcp_config.json',
}

export interface ServerInfo {
  slug: string
  name: string
  links: { repository: string | null }
  packages: { registryType: string; identifier: string }[]
  envVars: { name: string; description: string | null; required: boolean; secret: boolean }[]
  remotes: { transport: string; url: string }[]
}

export type LocalSpec = { command: string; args: string[]; env: Record<string, string> }

const PACKAGE_ORDER = ['npm', 'pypi', 'oci']

export function localSpec(d: Pick<ServerInfo, 'packages' | 'envVars'>): LocalSpec | null {
  const pkg = [...d.packages].filter((p) => PACKAGE_ORDER.includes(p.registryType)).sort((a, b) => PACKAGE_ORDER.indexOf(a.registryType) - PACKAGE_ORDER.indexOf(b.registryType))[0]
  if (!pkg) return null
  const env = Object.fromEntries(d.envVars.map((e) => [e.name, `<${e.name}>`]))
  if (pkg.registryType === 'npm') return { command: 'npx', args: ['-y', pkg.identifier], env }
  if (pkg.registryType === 'pypi') return { command: 'uvx', args: [pkg.identifier], env }
  return { command: 'docker', args: ['run', '-i', '--rm', ...d.envVars.flatMap((e) => ['-e', e.name]), pkg.identifier], env }
}

/** 安装包是否像是这个项目的（与网站的 packageBelongs 一致）：合并时偶尔会串进别的项目的包 */
export function packageBelongs(d: Pick<ServerInfo, 'name' | 'slug' | 'links'>, identifier: string): boolean {
  const hay = `${d.name} ${d.slug} ${d.links.repository ?? ''}`.toLowerCase()
  const flat = hay.replace(/[^a-z0-9]/g, '')
  const words = identifier.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !['server', 'servers', 'model', 'context', 'protocol', 'latest'].includes(w))
  return words.length === 0 || words.some((w) => hay.includes(w) || flat.includes(w))
}

/** 配置里用的服务名：slug 的小写字母、数字和连字符，最长 40 */
export const serverKey = (slug: string) => slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server'

const shellQuote = (a: string) => (/^[\w@/.:=<>-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
const tomlString = (s: string) => JSON.stringify(s)
const json = (v: unknown) => JSON.stringify(v, null, 2)

function localConfig(client: Client, key: string, spec: LocalSpec): string {
  const hasEnv = Object.keys(spec.env).length > 0
  const server = { command: spec.command, args: spec.args, ...(hasEnv ? { env: spec.env } : {}) }
  switch (client) {
    case 'claude-code':
      return ['claude mcp add', key, '--scope user', ...Object.entries(spec.env).map(([k, v]) => `--env ${k}=${shellQuote(v)}`), '--', spec.command, ...spec.args.map(shellQuote)].join(' ')
    case 'codex':
      return [
        `[mcp_servers.${key}]`,
        `command = ${tomlString(spec.command)}`,
        `args = [${spec.args.map(tomlString).join(', ')}]`,
        ...(hasEnv ? [`env = { ${Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ')} }`] : []),
      ].join('\n')
    case 'vscode':
      return json({ servers: { [key]: { type: 'stdio', ...server } } })
    default:
      return json({ mcpServers: { [key]: server } })
  }
}

function remoteConfig(client: Client, key: string, url: string, transport: string): string {
  const sse = transport === 'sse'
  switch (client) {
    case 'claude-code':
      return `claude mcp add --scope user --transport ${sse ? 'sse' : 'http'} ${key} ${url}`
    case 'codex':
      return `[mcp_servers.${key}]\nurl = ${tomlString(url)}`
    case 'gemini-cli':
      return json({ mcpServers: { [key]: sse ? { url } : { httpUrl: url } } })
    case 'vscode':
      return json({ servers: { [key]: { type: sse ? 'sse' : 'http', url } } })
    case 'windsurf':
      return json({ mcpServers: { [key]: { serverUrl: url } } })
    case 'claude-desktop':
      // Claude Desktop 的配置文件只支持本地命令，远程服务经 mcp-remote 转接
      return json({ mcpServers: { [key]: { command: 'npx', args: ['-y', 'mcp-remote', url] } } })
    default:
      return json({ mcpServers: { [key]: { url } } })
  }
}

export interface McpConfig {
  /** remote：直接连远程地址；local：在本机启动安装包 */
  mode: 'remote' | 'local'
  file: string
  config: string
  /** 需要用户填写的环境变量 */
  envVars: ServerInfo['envVars']
  /** 安装包看起来不像这个项目的，需要提醒用户核对 */
  unverifiedPackage: boolean
}

/** 有远程地址时优先用远程（不用安装）；都没有时返回 null */
export function buildConfig(d: ServerInfo, client: Client): McpConfig | null {
  const key = serverKey(d.slug)
  const remote = d.remotes[0]
  if (remote) return { mode: 'remote', file: CLIENT_FILES[client], config: remoteConfig(client, key, remote.url, remote.transport), envVars: [], unverifiedPackage: false }
  const spec = localSpec(d)
  if (!spec) return null
  const identifier = spec.args.at(-1) ?? ''
  return { mode: 'local', file: CLIENT_FILES[client], config: localConfig(client, key, spec), envVars: d.envVars, unverifiedPackage: !packageBelongs(d, identifier) }
}
