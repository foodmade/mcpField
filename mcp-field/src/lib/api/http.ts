/*
 * 后端接口的基础地址：
 * - 服务端渲染（loader）直接走内网访问 API（API_ORIGIN，默认同机的 3100 端口）
 * - 浏览器里走同域 /api，由前端服务（server.js）反向代理到 API
 */
const serverEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
const BASE = import.meta.env.SSR ? `${serverEnv?.API_ORIGIN ?? 'http://127.0.0.1:3100'}/api` : (import.meta.env.VITE_API_BASE ?? '/api')

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  get notFound() {
    return this.status === 404
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>

export async function apiGet<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`

  let res: Response
  try {
    res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ApiError(0, 'network_error', '无法连接到服务器')
  }
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? res.statusText)
  return body as T
}
