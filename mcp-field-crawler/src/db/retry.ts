import { setTimeout as sleep } from 'node:timers/promises'

/** MySQL 死锁 / 锁等待超时：被回滚的事务可以安全地整体重试 */
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'])

export function isRetryableDbError(error: unknown): boolean {
  // drizzle 会把驱动的错误包在 cause 里
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, errno } = e as { code?: string; errno?: number }
    if ((code && RETRYABLE.has(code)) || errno === 1213 || errno === 1205) return true
  }
  return false
}

/**
 * 遇到死锁时重试整个写操作（最多 4 次，随机退避）。
 * 用于"先删后插"这类并发写同一张表的事务：InnoDB 的间隙锁在并发下可能互相等待。
 */
export async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (error) {
      if (i >= attempts || !isRetryableDbError(error)) throw error
      await sleep(20 + Math.random() * 80 * i)
    }
  }
}
