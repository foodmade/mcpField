import { describe, expect, it } from 'vitest'
import { TtlCache } from '../src/api/http/ttl-cache.ts'

/** 等后台刷新的 Promise 回调执行完 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('TtlCache', () => {
  it('有效期内共用一次查询（含并发的相同请求）', async () => {
    let calls = 0
    const cache = new TtlCache<number>(1000, 10, () => 0)
    const load = async () => ++calls
    expect(await Promise.all([cache.get('a', load), cache.get('a', load)])).toEqual([1, 1])
    expect(await cache.get('a', load)).toBe(1)
    expect(calls).toBe(1)
  })

  it('过期后先返回旧结果、后台只刷新一次，刷新完返回新结果', async () => {
    let now = 0
    let calls = 0
    const cache = new TtlCache<number>(1000, 10, () => now)
    const load = async () => ++calls
    await cache.get('a', load)
    now = 1001
    expect(await Promise.all([cache.get('a', load), cache.get('a', load)])).toEqual([1, 1])
    await settle()
    expect(calls).toBe(2)
    expect(await cache.get('a', load)).toBe(2)
  })

  it('后台刷新失败时继续用旧结果，下次请求再试', async () => {
    let now = 0
    const cache = new TtlCache<string>(1000, 10, () => now)
    await cache.get('a', async () => 'old')
    now = 1001
    expect(await cache.get('a', () => Promise.reject(new Error('db down')))).toBe('old')
    await settle()
    expect(await cache.get('a', async () => 'new')).toBe('old')
    await settle()
    expect(await cache.get('a', async () => 'newer')).toBe('new')
  })

  it('第一次查询失败的不缓存', async () => {
    const cache = new TtlCache<string>(1000, 10, () => 0)
    await expect(cache.get('a', () => Promise.reject(new Error('db down')))).rejects.toThrow('db down')
    expect(await cache.get('a', async () => 'ok')).toBe('ok')
  })

  it('超过上限时淘汰最久没用到的', async () => {
    let calls = 0
    const cache = new TtlCache<number>(1000, 2, () => 0)
    const load = async () => ++calls
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('a', load)
    await cache.get('c', load)
    expect(await cache.get('a', load)).toBe(1)
    expect(await cache.get('b', load)).toBe(4)
  })
})
