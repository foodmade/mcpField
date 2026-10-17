import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProbeTarget } from './local-targets.ts'
import type { LocalProbeResult, LocalProbeStatus } from './tools-store.ts'

/*
 * 在 Docker 里实测本地服务（stdio）的工具列表。运行的是第三方代码，所以：
 *   装包：联网，npm 不执行安装脚本（--ignore-scripts）；
 *   启动：断网、非 root、只读文件系统（只有 /tmp 可写，也是工作目录）、去掉全部 capability、限制内存 / CPU / 进程数，必填环境变量填假值；
 *   每个包一个数据卷，用完即删。不用共享的下载缓存：PyPI 包常带 torch 之类几 GB 的依赖，2026-10-16 测了 240 个包缓存就涨到 18GB。
 * 实测机上不放任何数据库或线上凭证（结果写成 JSONL，由线上导入）。
 */

const run = promisify(execFile)

/** Debian trixie（glibc 2.41）：bookworm 的 2.36 跑不了要求 GLIBC_2.38 的预编译程序（whodb） */
export const NODE_IMAGE = 'node:22-trixie-slim'
export const UV_IMAGE = 'ghcr.io/astral-sh/uv:python3.12-trixie-slim'
const LIMITS = ['--memory', '768m', '--cpus', '1', '--pids-limit', '256']
const PROTOCOL = '2025-06-18'
const MAX_PAGES = 10
const MAX_TOOLS = 1000

export interface SandboxOptions {
  installTimeoutMs?: number
  initTimeoutMs?: number
  /** 容器名前缀，同一台机器上并行跑多个任务时区分 */
  prefix?: string
  /** 装包用的 npm 源、PyPI 索引，不设置时用官方源 */
  npmRegistry?: string
  pypiIndex?: string
}

/** 选入口：名字带 mcp 的优先（pypreset 有 pypreset 和 pypreset-mcp），其次与包名相同的，最后第一个 */
const PICK = `
const pick = (bins, name) => {
  const short = name.split('/').pop().toLowerCase().replace(/[-_.]+/g, '-')
  const norm = (b) => b.toLowerCase().replace(/[-_.]+/g, '-')
  return bins.find((b) => norm(b) === short && /mcp/i.test(b)) || bins.find((b) => /mcp/i.test(b)) || bins.find((b) => norm(b) === short) || bins[0]
}`

/** npm：读 package.json 的 bin、repository、mcpName；用 node 运行入口文件（有的入口没有 shebang） */
const NPM_META = `${PICK}
const fs = require('fs'), path = require('path'), name = process.argv[1]
const dir = path.join('/work/node_modules', name)
const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
let bin = pj.bin; if (typeof bin === 'string') bin = { [name.split('/').pop()]: bin }
const bins = Object.keys(bin || {})
const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository && pj.repository.url
const meta = { version: pj.version, repository: repo || (/github\\.com/.test(pj.homepage || '') ? pj.homepage : undefined), mcpName: pj.mcpName }
if (!bins.length) { console.log(JSON.stringify({ ...meta, error: 'no_bin' })); process.exit(0) }
const key = pick(bins, name)
console.log(JSON.stringify({ ...meta, bin: key, bins, cmd: ['node', path.join(dir, bin[key])] }))`

/** PyPI：console_scripts 入口、Project-URL 里的代码仓库、简介里的 mcp-name: */
const PY_META = `
import json, re, sys, importlib.metadata as m
name = sys.argv[1]; d = m.distribution(name); md = d.metadata
bins = [e.name for e in d.entry_points if e.group == 'console_scripts']
urls = [u.split(',', 1)[-1].strip() for u in (md.get_all('Project-URL') or [])] + [md.get('Home-page') or '']
repo = next((u for u in urls if re.search(r'(github|gitlab|codeberg)\\.(com|org)/', u)), None)
desc = (md.get_payload() or '') + (md.get('Description') or '')
mn = re.search(r'mcp-name:\\s*([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)', desc)
meta = {'version': d.version, 'repository': repo, 'mcpName': mn.group(1) if mn else None}
norm = lambda b: re.sub(r'[-_.]+', '-', b).lower()
short = norm(name)
key = next((b for b in bins if norm(b) == short and 'mcp' in b.lower()), None) or next((b for b in bins if 'mcp' in b.lower()), None) or next((b for b in bins if norm(b) == short), None) or (bins[0] if bins else None)
print(json.dumps({**meta, 'error': 'no_bin'} if not key else {**meta, 'bin': key, 'bins': bins, 'cmd': ['/work/venv/bin/' + key]}))`

/** 系统 Python 不满足 requires-python 时依次换 uv 托管的版本（装在数据卷里，启动时还要用） */
const PY_INSTALL = `
for py in $PYTHONS; do
  rm -rf /work/venv
  if uv venv -q --python "$py" /work/venv && uv pip install -q --python /work/venv/bin/python "$@" 2>/tmp/err; then ok=1; break; fi
  cat /tmp/err >&2
  grep -qiE 'requires-python|does not satisfy python|python>=' /tmp/err || break
done
[ -n "$ok" ] && /work/venv/bin/python -c "$META" "$NAME"`

const NPM_INSTALL = `cd /work && npm init -y >/dev/null && npm install --cache /tmp/npm-cache --no-audit --no-fund --ignore-scripts --loglevel=error "$1" >&2 && node -e "$META" "$NAME"`

interface Installed {
  cmd?: string[]
  bin?: string
  bins?: string[]
  version?: string
  repository?: string | null
  mcpName?: string | null
  error?: string
}

/** 必填环境变量的假值：多数服务启动时只检查有没有，调用工具时才真正用 */
export function dummyEnv(names: string[]): string[] {
  const out: string[] = []
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const n = name.toUpperCase()
    // 填了不存在的 profile 会直接报错（botocore ProfileNotFound），改给假的密钥
    if (n === 'AWS_PROFILE') {
      out.push('-e', 'AWS_ACCESS_KEY_ID=dummy', '-e', 'AWS_SECRET_ACCESS_KEY=dummy')
      continue
    }
    const value = /URL|ENDPOINT|HOST/.test(n) ? 'https://example.com' : /LOG_LEVEL/.test(n) ? 'ERROR' : /REGION/.test(n) ? 'us-east-1' : /PORT/.test(n) ? '8080' : 'dummy'
    out.push('-e', `${name}=${value}`)
  }
  return out
}

const norm = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')

/**
 * 依次尝试的启动参数：Registry 登记的参数（第一个是入口名时去掉：uvx 写法 basic-memory mcp），
 * 启动失败再试不带参数（有的登记的是 HTTP 模式的端口，@agent-infra/* 的 8089）。
 */
export function launchAttempts(args: string[], bins: string[]): string[][] {
  const own = args.length && bins.some((b) => norm(b) === norm(args[0]!)) ? args.slice(1) : args
  return own.length ? [own, []] : [[]]
}

/** 启动后马上退出、输出里提到 mcp 子命令的 CLI（xcodebuildmcp：Run 'xcodebuildmcp mcp' to start the MCP server），再试 mcp 子命令 */
export const hintsMcpSubcommand = (error: string | undefined) => !!error && (/^exit 0\b/.test(error) || /\bmcp\b/i.test(error))

const tail = (text: string, lines = 3) => text.trim().split('\n').slice(-lines).join(' | ').slice(0, 500)

export class DockerSandbox {
  private seq = 0
  private readonly installTimeoutMs: number
  private readonly initTimeoutMs: number
  private readonly prefix: string
  private readonly npmRegistry?: string
  private readonly pypiIndex?: string

  constructor(options: SandboxOptions = {}) {
    this.installTimeoutMs = options.installTimeoutMs ?? 300_000
    this.initTimeoutMs = options.initTimeoutMs ?? 45_000
    this.prefix = options.prefix ?? `mcpprobe-${process.pid}`
    this.npmRegistry = options.npmRegistry
    this.pypiIndex = options.pypiIndex
  }

  async probe(target: ProbeTarget): Promise<LocalProbeResult> {
    const name = `${this.prefix}-${++this.seq}`
    const base = { key: target.key, probedAt: new Date().toISOString() }
    try {
      let installed = await this.install(name, target, target.version)
      // Registry 登记的版本可能不存在或已撤回（msmcp-azure==3.0.0b48），改装最新版
      if (installed.error && installed.error !== 'no_bin' && target.version) installed = await this.install(name, target, undefined)
      const meta = { version: installed.version, bin: installed.bin, repository: installed.repository ?? undefined, mcpName: installed.mcpName ?? undefined }
      if (installed.error || !installed.cmd) return { ...base, ...meta, status: (installed.error === 'no_bin' ? 'no_bin' : 'install_failed') as LocalProbeStatus, error: installed.error === 'no_bin' ? undefined : installed.error }
      const image = target.registryType === 'npm' ? NODE_IMAGE : UV_IMAGE
      const attempts = launchAttempts(target.args, installed.bins ?? [])
      let listed: Awaited<ReturnType<DockerSandbox['listTools']>> | undefined
      let args: string[] = []
      for (let i = 0; i < attempts.length; i++) {
        args = attempts[i]!
        listed = await this.listTools(name, image, [...installed.cmd, ...args], target.env)
        // 只有启动后马上退出才换参数重试；超时、握手出错的换参数也没用
        if (listed.status !== 'start_failed') break
        if (i === attempts.length - 1 && !attempts.some((a) => a[0] === 'mcp') && hintsMcpSubcommand(listed.error)) attempts.push(['mcp'])
      }
      return { ...base, ...meta, ...(args.length ? { args } : {}), ...listed! }
    } finally {
      await run('docker', ['volume', 'rm', '-f', name]).catch(() => {})
    }
  }

  private async install(volume: string, target: ProbeTarget, version: string | undefined): Promise<Installed> {
    let image: string
    let script: string
    let specs: string[]
    const env: string[] = []
    if (target.registryType === 'npm') {
      image = NODE_IMAGE
      script = NPM_INSTALL
      specs = [version ? `${target.name}@${version}` : target.name]
      env.push('-e', `META=${NPM_META}`)
      if (this.npmRegistry) env.push('-e', `npm_config_registry=${this.npmRegistry}`)
    } else {
      image = UV_IMAGE
      script = PY_INSTALL
      specs = [target.installSpec ?? (version ? `${target.name}==${version}` : target.name), ...(target.withSpecs ?? [])]
      const pythons = [...new Set([target.python, '3.12', '3.13', '3.14'].filter(Boolean))].join(' ')
      env.push('-e', `META=${PY_META}`, '-e', `PYTHONS=${pythons}`, '-e', 'UV_NO_CACHE=1', '-e', 'UV_PYTHON_INSTALL_DIR=/work/py', '-e', 'UV_LINK_MODE=copy', '-e', 'UV_PRERELEASE=allow')
      if (this.pypiIndex) env.push('-e', `UV_DEFAULT_INDEX=${this.pypiIndex}`)
    }
    env.push('-e', `NAME=${target.name}`)
    try {
      const { stdout } = await run(
        'docker',
        ['run', '--rm', '--name', `${volume}-install`, ...LIMITS, ...env, '-v', `${volume}:/work`, '--entrypoint', 'sh', image, '-c', script, 'sh', ...specs],
        { timeout: this.installTimeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 << 20 },
      )
      return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Installed
    } catch (error) {
      await run('docker', ['rm', '-f', `${volume}-install`]).catch(() => {})
      const e = error as { killed?: boolean; stderr?: string; message?: string }
      return { error: e.killed ? 'install timeout' : tail(e.stderr || e.message || '') }
    }
  }

  /** 断网启动，stdio 上做 initialize → notifications/initialized → tools/list（分页） */
  private listTools(volume: string, image: string, cmd: string[], envNames: string[]): Promise<Pick<LocalProbeResult, 'status' | 'error' | 'server' | 'tools'>> {
    const container = `${volume}-run`
    const child = spawn(
      'docker',
      [
        'run', '--rm', '-i', '--name', container, '--network', 'none', ...LIMITS,
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
        '--read-only', '--tmpfs', '/tmp:size=64m', '-w', '/tmp', '-e', 'HOME=/tmp', '-e', 'GIT_PYTHON_REFRESH=quiet', ...dummyEnv(envNames),
        '-v', `${volume}:/work:ro`, '--entrypoint', cmd[0]!, image, ...cmd.slice(1),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const rpc = new StdioRpc(child)
    return (async () => {
      try {
        const init = await rpc.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mcpfield-probe', version: '1.0' } }, this.initTimeoutMs)
        if (init.error) return { status: 'protocol' as const, error: JSON.stringify(init.error).slice(0, 500) }
        const info = (init.result as { serverInfo?: { name?: string; version?: string } } | undefined)?.serverInfo
        const server = info ? { name: info.name, version: info.version } : undefined
        rpc.notify('notifications/initialized')
        const tools: unknown[] = []
        let cursor: string | undefined
        for (let page = 0; page < MAX_PAGES && tools.length < MAX_TOOLS; page++) {
          const res = await rpc.request('tools/list', cursor ? { cursor } : {}, 20_000)
          if (res.error) return { status: 'protocol' as const, error: JSON.stringify(res.error).slice(0, 500), server }
          const result = res.result as { tools?: unknown[]; nextCursor?: string } | undefined
          tools.push(...(result?.tools ?? []))
          cursor = result?.nextCursor
          if (!cursor) break
        }
        return { status: 'ok' as const, server, tools: tools.slice(0, MAX_TOOLS) }
      } catch (error) {
        const exited = rpc.exitCode !== undefined
        return { status: (exited ? 'start_failed' : 'timeout') as LocalProbeStatus, error: [exited ? `exit ${rpc.exitCode}` : (error as Error).message, tail(rpc.output)].filter(Boolean).join(': ') }
      } finally {
        await run('docker', ['kill', container]).catch(() => {})
        await rpc.closed
      }
    })()
  }
}

interface RpcMessage {
  id?: number
  result?: unknown
  error?: unknown
}

/** 按行读写 JSON-RPC；服务往 stdout 打的日志（非 JSON 行）和 stderr 一起收进 output，用来报告失败原因 */
export class StdioRpc {
  output = ''
  exitCode: number | null | undefined
  readonly closed: Promise<void>
  private buffer = ''
  private nextId = 1
  private readonly waiting = new Map<number, (msg: RpcMessage) => void>()

  constructor(private readonly child: { stdin: NodeJS.WritableStream | null; stdout: NodeJS.ReadableStream | null; stderr: NodeJS.ReadableStream | null; once(event: 'exit', fn: (code: number | null) => void): unknown }) {
    child.stderr?.on('data', (d: Buffer) => {
      this.log(d.toString())
    })
    child.stdout?.on('data', (d: Buffer) => this.feed(d.toString()))
    child.stdin?.on('error', () => {})
    this.closed = new Promise((resolve) =>
      child.once('exit', (code) => {
        this.exitCode = code
        resolve()
      }),
    )
  }

  private log(text: string): void {
    this.output = (this.output + text).slice(-4000)
  }

  feed(chunk: string): void {
    this.buffer += chunk
    let i: number
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).trim()
      this.buffer = this.buffer.slice(i + 1)
      if (!line.startsWith('{')) {
        if (line) this.log(line + '\n')
        continue
      }
      try {
        const msg = JSON.parse(line) as RpcMessage
        if (typeof msg.id === 'number') this.waiting.get(msg.id)?.(msg)
      } catch {
        // 不是完整的 JSON，当作日志
      }
    }
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<RpcMessage> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error('timeout'))
      }, timeoutMs)
      this.waiting.set(id, (msg) => {
        clearTimeout(timer)
        this.waiting.delete(id)
        resolve(msg)
      })
      void this.closed.then(() => {
        if (!this.waiting.has(id)) return
        clearTimeout(timer)
        this.waiting.delete(id)
        reject(new Error('exited'))
      })
      this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  notify(method: string): void {
    this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n')
  }
}
