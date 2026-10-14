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

export async function apiGet<T>(path: string, query: Query = {}, signal?: AbortSignal, token?: string): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  return request<T>(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { signal, headers: headers(token) })
}

/** 写接口：JSON 请求体，带登录令牌；204 时返回 null */
export async function apiSend<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, token?: string): Promise<T> {
  return request<T>(`${BASE}${path}`, {
    method,
    headers: { ...headers(token), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const headers = (token?: string): Record<string, string> => ({ accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) })

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiError(0, 'network_error', '无法连接到服务器')
  }
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'http_error', body?.error?.message ?? res.statusText)
  return body as T
}
