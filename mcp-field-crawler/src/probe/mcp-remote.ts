import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ToolDraft } from '../core/draft.ts'
import { toToolDrafts } from '../extract/mcp-tools.ts'

/*
 * 实时读取远程 MCP 服务的工具列表：initialize → notifications/initialized → tools/list（分页）。
 * 只支持 Streamable HTTP。目标地址来自收录数据，属于第三方输入，因此：
 * 只允许 https、拒绝解析到内网/本机的地址、不跟随重定向、限制超时和响应大小。
 */

const PROTOCOL = '2025-06-18'
const TIMEOUT_MS = 12_000
const MAX_BYTES = 2 * 1024 * 1024
const MAX_PAGES = 10

export type ProbeError = 'auth' | 'network' | 'protocol' | 'unsupported' | 'blocked'
export type ProbeResult = { tools: ToolDraft[] } | { error: ProbeError; status?: number }

export class BlockedTargetError extends Error {}

/** 内网、本机、链路本地、保留地址 */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6)
}

/** 只允许解析到公网地址的 https 目标 */
export async function assertPublicHttps(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedTargetError('地址无效')
  }
  if (url.protocol !== 'https:') throw new BlockedTargetError('只允许 https')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new BlockedTargetError('地址指向内网或本机')
  return url
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error('响应过大')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

type RpcResult = { status: number; sessionId: string | null; message?: { result?: unknown; error?: { message: string } } }

async function rpc(url: string, body: Record<string, unknown>, sessionId: string | null): Promise<RpcResult> {
  const res = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const sid = res.headers.get('mcp-session-id') ?? sessionId
  const text = await readLimited(res)
  if (!('id' in body) || !res.ok) return { status: res.status, sessionId: sid }
  // Streamable HTTP 可能返回 JSON，也可能返回 SSE；取与请求 id 对应的那条消息
  const payloads = (res.headers.get('content-type') ?? '').includes('event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())
    : [text]
  for (const p of payloads) {
    try {
      const msg = JSON.parse(p) as { id?: unknown }
      if (msg.id === body.id) return { status: res.status, sessionId: sid, message: msg as RpcResult['message'] }
    } catch {
      /* 忽略非 JSON 的心跳行 */
    }
  }
  return { status: res.status, sessionId: sid }
}

const denied = (status: number) => status === 401 || status === 403

export async function listRemoteTools(rawUrl: string, transport: string): Promise<ProbeResult> {
  if (transport === 'sse') return { error: 'unsupported' }
  let url: URL
  try {
    url = await assertPublicHttps(rawUrl)
  } catch (error) {
    return { error: error instanceof BlockedTargetError ? 'blocked' : 'network' }
  }
  try {
    const target = url.toString()
    const init = await rpc(target, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mcpfield', version: '0.1.0' } } }, null)
    if (denied(init.status)) return { error: 'auth', status: init.status }
    if (!init.message?.result) return { error: 'protocol', status: init.status }
    await rpc(target, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId)

    const raw: unknown[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await rpc(target, { jsonrpc: '2.0', id: 2 + page, method: 'tools/list', params: cursor ? { cursor } : {} }, init.sessionId)
      if (denied(r.status)) return { error: 'auth', status: r.status }
      const result = r.message?.result as { tools?: unknown[]; nextCursor?: string } | undefined
      if (!result) return { error: 'protocol', status: r.status }
      raw.push(...(result.tools ?? []))
      cursor = result.nextCursor
      if (!cursor) break
    }
    return { tools: toToolDrafts(raw) }
  } catch {
    return { error: 'network' }
  }
}
