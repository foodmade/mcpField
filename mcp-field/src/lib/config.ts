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

/**
 * 安装包是否属于这个项目：部分条目合并时串了别的项目的安装包（例如 Playwright 挂着 Slack 的包），
 * 包名里的词在名称、slug、仓库地址里都找不到时视为不可信，首页不展示，避免给出错误的启动命令。
 */
export function packageBelongs(d: Pick<ServerDetail, 'name' | 'slug' | 'links'>, identifier: string): boolean {
  const hay = `${d.name} ${d.slug} ${d.links.repository ?? ''}`.toLowerCase()
  const flat = hay.replace(/[^a-z0-9]/g, '')
  const words = identifier.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !['server', 'servers', 'model', 'context', 'protocol', 'latest'].includes(w))
  return words.length === 0 || words.some((w) => hay.includes(w) || flat.includes(w))
}

/** 首页卡片上的一行接入方式：远程服务给地址，本地服务给启动命令；都没有（或安装包不可信）时为 null */
export function serverCommand(d: ServerDetail): string | null {
  if (d.remotes[0]) return d.remotes[0].url
  const spec = localSpec(d)
  return spec && packageBelongs(d, spec.args.at(-1) ?? '') ? runCommand(spec) : null
}

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
        out.push({ text: w, cls: /^\s+$/.test(w) ? '' : i === 0 ? 'text-code' : w.startsWith('-') ? 'text-sky' : w.startsWith('http') ? 'text-amber' : 'text-ink/90' })
      })
      return out
    }
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],:])|(\s+)|([^\s"{}[\],:]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      if (m[1] && m[2]) out.push({ text: m[1], cls: 'text-sky' }, { text: m[2], cls: 'text-fg/55' })
      else if (m[1]) out.push({ text: m[1], cls: 'text-amber' })
      else if (m[3]) out.push({ text: m[3], cls: 'text-fg/55' })
      else if (m[4]) out.push({ text: m[4], cls: '' })
      else out.push({ text: m[5], cls: 'text-code' })
    }
    return out
  })
}
