import { describe, expect, it } from 'vitest'
import { isRetryableDbError, withDeadlockRetry } from '../src/db/retry.ts'

const deadlock = () => Object.assign(new Error('Failed query: insert …'), { cause: Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 }) })

describe('withDeadlockRetry', () => {
  it('识别包在 cause 里的死锁错误', () => {
    expect(isRetryableDbError(deadlock())).toBe(true)
    expect(isRetryableDbError(new Error('Duplicate entry'))).toBe(false)
  })

  it('死锁时重试直到成功；其他错误立即抛出', async () => {
    let calls = 0
    await expect(withDeadlockRetry(async () => (++calls < 3 ? Promise.reject(deadlock()) : 'ok'))).resolves.toBe('ok')
    expect(calls).toBe(3)
    let other = 0
    await expect(withDeadlockRetry(async () => { other++; throw new Error('boom') })).rejects.toThrow('boom')
    expect(other).toBe(1)
  })
})
