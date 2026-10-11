import { setTimeout as sleep } from 'node:timers/promises'
import { HttpError } from '../core/errors.ts'
import type { Logger } from '../core/logger.ts'
import type { FetchMiddleware } from './compose.ts'

export interface RetryOptions {
  maxRetries: number
  baseDelayMs?: number
  maxDelayMs?: number
  logger?: Logger
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.retryable
  // fetch 的网络错误是 TypeError，超时是 TimeoutError
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
}

/** 临时错误时指数退避重试；服务端给了 Retry-After 就按它等待 */
export function withRetry(options: RetryOptions): FetchMiddleware {
  const base = options.baseDelayMs ?? 1_000
  const cap = options.maxDelayMs ?? 60_000

  return (next) => ({
    async fetch(request) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await next.fetch(request)
        } catch (error) {
          if (attempt >= options.maxRetries || !isRetryable(error)) throw error
          const hinted = error instanceof HttpError ? error.retryAfterMs : undefined
          const delay = Math.min(cap, hinted ?? Math.random() * base * 2 ** attempt)
          options.logger?.warn({ url: request.url, attempt: attempt + 1, delay: Math.round(delay), err: String(error) }, '请求失败，稍后重试')
          await sleep(delay)
        }
      }
    },
  })
}
