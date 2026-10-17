import { describe, expect, it } from 'vitest'
import { beijingDate, finalStatus, parseProgress, summarizeStats } from '../src/admin/jobs.ts'
import { hashPassword, passwordProblem, verifyPassword } from '../src/admin/password.ts'
import { dbTime } from '../src/admin/time.ts'

describe('任务埋点', () => {
  it('汇总各任务统计里的成功、待抽查、失败条数，嵌套一层的一起加', () => {
    expect(summarizeStats({ ok: 3, review: 1, failed: 2, requests: 9 })).toEqual({ ok: 3, review: 1, failed: 2 })
    expect(summarizeStats({ repos: { ok: 10, failed: 1 }, readme: { ok: 5, failed: 0 } })).toEqual({ ok: 15, review: null, failed: 1 })
    expect(summarizeStats({ records: 7, failed: 0 })).toEqual({ ok: 7, review: null, failed: 0 })
    expect(summarizeStats(undefined)).toEqual({ ok: null, review: null, failed: null })
  })
  it('解析日志里的进度', () => {
    expect(parseProgress('12/340')).toEqual({ done: 12, total: 340 })
    expect(parseProgress('20000')).toBeNull()
    expect(parseProgress(undefined)).toBeNull()
  })
  it('结束状态：中断优先，其次抛错，有失败条目为警告', () => {
    expect(finalStatus({ interrupted: true, error: new Error('x') })).toBe('interrupted')
    expect(finalStatus({ error: new Error('x') })).toBe('failed')
    expect(finalStatus({ failed: 3 })).toBe('warning')
    expect(finalStatus({ failed: 0 })).toBe('succeeded')
  })
  it('按北京时间归日', () => {
    expect(beijingDate(new Date('2026-10-16T19:30:00Z'))).toBe('2026-10-17')
    expect(beijingDate(new Date('2026-10-16T15:59:59Z'))).toBe('2026-10-16')
  })
  it('数据库里不带时区的时间按 UTC 解析', () => {
    expect(dbTime('2026-10-17 01:37:43.171').toISOString()).toBe('2026-10-17T01:37:43.171Z')
    expect(dbTime('2026-10-17T01:37:43.171Z').toISOString()).toBe('2026-10-17T01:37:43.171Z')
  })
})

describe('后台密码', () => {
  it('哈希可以校验，错误密码不通过', async () => {
    const hash = await hashPassword('correct horse')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('correct horse', hash)).toBe(true)
    expect(await verifyPassword('wrong horse', hash)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
  it('密码长度要求', () => {
    expect(passwordProblem('short')).toBe('密码至少 8 个字符')
    expect(passwordProblem('long enough')).toBeNull()
  })
})
