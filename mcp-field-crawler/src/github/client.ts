import { setTimeout as delay } from 'node:timers/promises'
import { HttpError } from '../core/errors.ts'
import type { Logger } from '../core/logger.ts'

const API = 'https://api.github.com'
/** 剩余额度低于这个数就暂停到重置时间，给并发中的请求留余量 */
const RESERVE = 10
/** 连续触发限流的最多等待次数 */
const MAX_RATE_LIMIT_WAITS = 5
/** 不返回 4xx 错误、交给调用方判断的状态码：仓库或文件不存在、被封禁、无权访问 */
const PASS_THROUGH = new Set([403, 404, 410, 451])

export interface GithubResponse<T> {
  /** 200 / 304 / 403 / 404 / 410 / 451；其余错误抛 HttpError */
  status: number
  etag: string | null
  data: T | null
}

export interface GraphqlError {
  type?: string
  path?: (string | number)[]
  message: string
}

/** REST 和 GraphQL 的额度分开计算 */
type Resource = 'core' | 'graphql'

interface Quota {
  remaining: number | null
  resetAt: number
  pause: Promise<void> | null
}

export interface GithubClientOptions {
  token?: string
  userAgent: string
  logger: Logger
  timeoutMs?: number
  maxRetries?: number
  /** 测试时注入 */
  fetch?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * GitHub 客户端（REST + GraphQL）：
 * - 带 token；条件请求（If-None-Match）返回 304 时不占额度
 * - 按响应头里的剩余额度自动暂停到重置时间（REST、GraphQL 分别计算）；触发限流（403 / 429）时按 Retry-After 或重置时间等待后重试
 * - 5xx 和网络错误指数退避重试
 * - 404 / 410 / 451 和非限流的 403 不抛错，返回状态码由调用方判断
 */
export class GithubClient {
  private readonly quotas: Record<Resource, Quota> = { core: { remaining: null, resetAt: 0, pause: null }, graphql: { remaining: null, resetAt: 0, pause: null } }
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>

  constructor(private readonly options: GithubClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))
  }

  get<T>(path: string, options: { etag?: string; signal?: AbortSignal } = {}): Promise<GithubResponse<T>> {
    return this.request<T>('core', path, options)
  }

  /** GraphQL 查询；部分节点出错（例如仓库不存在）时 data 里对应项为 null，错误放在 errors 里，不抛错 */
  async graphql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: T | null; errors: GraphqlError[] }> {
    const res = await this.request<{ data?: T | null; errors?: GraphqlError[] }>('graphql', '/graphql', { body: JSON.stringify({ query, variables }), signal })
    if (res.status !== 200 || !res.data) throw new HttpError(API + '/graphql', res.status)
    return { data: res.data.data ?? null, errors: res.data.errors ?? [] }
  }

  private async request<T>(resource: Resource, path: string, options: { etag?: string; body?: string; signal?: AbortSignal }): Promise<GithubResponse<T>> {
    const url = API + path
    const quota = this.quotas[resource]
    const maxRetries = this.options.maxRetries ?? 3
    let limited = 0
    for (let attempt = 0; ; ) {
      await this.waitForQuota(quota, options.signal)
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: options.body ? 'POST' : 'GET',
          headers: this.headers(options.etag),
          body: options.body,
          signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        })
      } catch (error) {
        if (options.signal?.aborted || attempt >= maxRetries) throw error
        await this.backoff(attempt++, url, error, options.signal)
        continue
      }
      track(quota, response.headers)
      const { status } = response
      if (status === 200) return { status, etag: response.headers.get('etag'), data: (await response.json()) as T }
      // 403 可能是限流，也可能是仓库被封禁，要看错误信息
      const message = status === 403 || status === 429 ? await response.text() : (await response.body?.cancel(), '')
      if (status === 304) return { status, etag: response.headers.get('etag') ?? options.etag ?? null, data: null }

      const wait = rateLimitWait(response, message)
      if (wait !== undefined && limited < MAX_RATE_LIMIT_WAITS) {
        limited++
        this.options.logger.warn({ url, seconds: Math.round(wait / 1000) }, 'GitHub 接口限流，等待后重试')
        await this.sleep(wait, options.signal)
        // 已经等到限流解除，额度以下一次响应为准
        quota.remaining = null
        continue
      }
      if (PASS_THROUGH.has(status)) return { status, etag: null, data: null }
      const error = new HttpError(url, status)
      if (!error.retryable || attempt >= maxRetries) throw error
      await this.backoff(attempt++, url, error, options.signal)
    }
  }

  private headers(etag?: string): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': this.options.userAgent,
      ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
      ...(etag ? { 'if-none-match': etag } : {}),
    }
  }

  /** 额度快用完时，同一类请求一起等到重置时间 */
  private async waitForQuota(quota: Quota, signal?: AbortSignal): Promise<void> {
    if (quota.remaining === null || quota.remaining > RESERVE) return
    const ms = quota.resetAt - Date.now()
    if (ms <= 0) {
      quota.remaining = null
      return
    }
    quota.pause ??= (async () => {
      this.options.logger.warn({ minutes: Math.ceil(ms / 60_000) }, 'GitHub 额度快用完，等待额度重置')
      await this.sleep(ms + 1_000, signal)
      quota.remaining = null
    })().finally(() => {
      quota.pause = null
    })
    await quota.pause
  }

  private async backoff(attempt: number, url: string, error: unknown, signal?: AbortSignal): Promise<void> {
    const ms = Math.min(30_000, 1_000 * 2 ** attempt)
    this.options.logger.warn({ url, attempt: attempt + 1, delay: ms, err: String(error) }, 'GitHub 请求失败，稍后重试')
    await this.sleep(ms, signal)
  }
}

function track(quota: Quota, headers: Headers): void {
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  if (remaining !== null && Number.isFinite(Number(remaining))) quota.remaining = Number(remaining)
  if (reset !== null && Number.isFinite(Number(reset))) quota.resetAt = Number(reset) * 1000
}

/** 限流响应的等待时间；不是限流时返回 undefined */
function rateLimitWait(response: Response, message: string): number | undefined {
  if (response.status !== 403 && response.status !== 429) return undefined
  const retryAfter = Number(response.headers.get('retry-after'))
  if (retryAfter > 0) return retryAfter * 1000
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
    return Math.max(1_000, reset - Date.now() + 1_000)
  }
  // 次级限流有时不带 Retry-After，官方建议至少等一分钟
  return response.status === 429 || /rate limit/i.test(message) ? 60_000 : undefined
}
