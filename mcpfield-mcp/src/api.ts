import { createRequire } from 'node:module'

/*
 * 调用 MCP Field 网站接口。公开接口（目录、详情）不带密钥；收藏接口带 MCPFIELD_API_KEY，
 * 同时用 X-MCPField-Client 报上 Agent 的名称（控制台的「最近使用」里显示）。
 */

export const VERSION: string = createRequire(import.meta.url)('../package.json').version
export const SITE = (process.env.MCPFIELD_API_URL || 'https://mcpfield.com').replace(/\/+$/, '')
export const KEYS_URL = `${SITE}/console/keys`
export const LOCALES = ['en', 'zh', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = (LOCALES as readonly string[]).includes(process.env.MCPFIELD_LOCALE ?? '') ? (process.env.MCPFIELD_LOCALE as Locale) : 'en'

export type Kind = 'server' | 'skill'
export const ROUTE: Record<Kind, string> = { server: 'servers', skill: 'skills' }
export const pageUrl = (kind: Kind, slug: string) => `${SITE}/${ROUTE[kind]}/${slug}`

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 密钥相关的错误换成能直接转述给用户的说明 */
const KEY_ERRORS: Record<string, string> = {
  missing_api_key: `MCPFIELD_API_KEY is not set. Create an API key at ${KEYS_URL} and pass it to this MCP server as the MCPFIELD_API_KEY environment variable.`,
  invalid_api_key: `The MCP Field API key is invalid or has been revoked. Create a new one at ${KEYS_URL} and update MCPFIELD_API_KEY.`,
  api_key_expired: `The MCP Field API key has expired. Create a new one at ${KEYS_URL} and update MCPFIELD_API_KEY.`,
  rate_limited: 'Too many requests to MCP Field (limit: 60 per minute per key). Wait a minute and try again.',
}

type Options = { method?: 'GET' | 'PUT' | 'DELETE' | 'POST'; query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean; client?: string | null }

export async function api<T>(path: string, o: Options = {}): Promise<T> {
  const key = process.env.MCPFIELD_API_KEY?.trim()
  if (o.auth && !key) throw new ApiError(401, 'missing_api_key', KEY_ERRORS.missing_api_key!)
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== '') qs.set(k, String(v))
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': `mcpfield-mcp/${VERSION}` }
  if (o.auth) headers.authorization = `Bearer ${key}`
  if (o.client) headers['x-mcpfield-client'] = o.client
  if (o.body !== undefined) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${SITE}/api${path}${qs.size ? `?${qs}` : ''}`, {
      method: o.method ?? 'GET',
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new ApiError(0, 'network_error', `Could not reach ${SITE}: ${(error as Error).message}`)
  }
  if (res.status === 204) return null as T
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) {
    const code = body?.error?.code ?? `http_${res.status}`
    throw new ApiError(res.status, code, KEY_ERRORS[code] ?? body?.error?.message ?? res.statusText)
  }
  return body as T
}
