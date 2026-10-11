import type { ServerDetail } from './api/entities'

export const CLIENTS = ['claude-desktop', 'cursor', 'vscode', 'claude-code', 'windsurf'] as const
export type ClientKey = (typeof CLIENTS)[number]

export const CLIENT_META: Record<ClientKey, { label: string; file: string; kind: 'json' | 'shell' }> = {
  'claude-desktop': { label: 'Claude Desktop', file: 'claude_desktop_config.json', kind: 'json' },
  cursor: { label: 'Cursor', file: '.cursor/mcp.json', kind: 'json' },
  vscode: { label: 'VS Code', file: '.vscode/mcp.json', kind: 'json' },
  'claude-code': { label: 'Claude Code', file: 'Terminal', kind: 'shell' },
  windsurf: { label: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json', kind: 'json' },
}

const shellQuote = (a: string) => (/^[\w@/.:=-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)

/** 本地运行方式：由收录的安装包推出启动命令；环境变量只给占位值 */
export type LocalSpec = { command: string; args: string[]; env: Record<string, string> }

const PACKAGE_ORDER = ['npm', 'pypi', 'oci']

export function localSpec(d: Pick<ServerDetail, 'packages' | 'envVars'>): LocalSpec | null {
  const pkg = [...d.packages].sort((a, b) => PACKAGE_ORDER.indexOf(a.registryType) - PACKAGE_ORDER.indexOf(b.registryType))[0]
  if (!pkg) return null
  const env = Object.fromEntries(d.envVars.map((e) => [e.name, `<${e.name}>`]))
  if (pkg.registryType === 'npm') return { command: 'npx', args: ['-y', pkg.identifier], env }
  if (pkg.registryType === 'pypi') return { command: 'uvx', args: [pkg.identifier], env }
  if (pkg.registryType === 'oci') return { command: 'docker', args: ['run', '-i', '--rm', ...d.envVars.flatMap((e) => ['-e', e.name]), pkg.identifier], env }
  return null
}

/** 本地服务：通用的 mcpServers 配置，各客户端写法一致 */
export function buildLocalConfig(key: string, spec: LocalSpec): string {
  const server = { command: spec.command, args: spec.args, ...(Object.keys(spec.env).length ? { env: spec.env } : {}) }
  return JSON.stringify({ mcpServers: { [key]: server } }, null, 2)
}

export const runCommand = (spec: LocalSpec) => [spec.command, ...spec.args].map(shellQuote).join(' ')

/** 远程服务：按客户端生成对应的安装命令或配置；transport 为 sse 时用 SSE，否则用 Streamable HTTP */
export function buildRemoteConfig(key: string, url: string, client: ClientKey, transport = 'streamable-http'): string {
  const type = transport === 'sse' ? 'sse' : 'http'
  if (client === 'claude-code') return `claude mcp add --transport ${type} ${key} ${url}`
  if (client === 'vscode') return JSON.stringify({ servers: { [key]: { type, url } } }, null, 2)
  if (client === 'windsurf') return JSON.stringify({ mcpServers: { [key]: { serverUrl: url } } }, null, 2)
  return JSON.stringify({ mcpServers: { [key]: { type, url } } }, null, 2)
}

/** 一键安装只适用于远程服务 */
export function installLinks(key: string, url: string, transport = 'streamable-http') {
  const type = transport === 'sse' ? 'sse' : 'http'
  return {
    cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(key)}&config=${btoa(JSON.stringify({ url }))}`,
    vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: key, type, url }))}`,
    claudeCode: buildRemoteConfig(key, url, 'claude-code', transport),
  }
}

export type Tok = { text: string; cls: string }

// 轻量语法高亮：JSON 区分键、字符串和标点；命令行区分命令、参数与值
export function highlight(code: string, kind: 'json' | 'shell'): Tok[][] {
  return code.split('\n').map((line) => {
    const out: Tok[] = []
    if (kind === 'shell') {
      line.split(/(\s+)/).forEach((w, i) => {
        if (!w) return
        out.push({ text: w, cls: /^\s+$/.test(w) ? '' : i === 0 ? 'text-[#7FD9B5]' : w.startsWith('-') ? 'text-[#9FC6FF]' : w.startsWith('http') ? 'text-[#F2C98A]' : 'text-ink/90' })
      })
      return out
    }
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m[1] && m[2]) out.push({ text: m[1], cls: 'text-[#9FC6FF]' }, { text: m[2], cls: 'text-white/55' })
      else if (m[1]) out.push({ text: m[1], cls: 'text-[#F2C98A]' })
      else if (m[3]) out.push({ text: m[3], cls: 'text-white/55' })
      else if (m[4]) out.push({ text: m[4], cls: '' })
      else out.push({ text: m[5], cls: 'text-[#7FD9B5]' })
    }
    return out
  })
}

/** 语法色（与 highlight 的 class 对应），供首屏打字机效果使用 */
const TOKEN_COLOR: Record<string, string> = {
  'text-[#9FC6FF]': '#9FC6FF',
  'text-[#F2C98A]': '#F2C98A',
  'text-[#7FD9B5]': '#7FD9B5',
  'text-white/55': '#FFFFFF8C',
  'text-ink/90': '#F3F4F6E6',
  '': '#F3F4F6',
}

export function colorTokens(code: string, kind: 'json' | 'shell' = 'json'): [string, string][][] {
  return highlight(code, kind).map((line) => line.map((t) => [t.text, TOKEN_COLOR[t.cls] ?? '#F3F4F6'] as [string, string]))
}
