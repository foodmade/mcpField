import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import { fitsField } from '../src/api/modules/stats/field.service.ts'
import { fillDays, StatsService, type SiteStats, type StatsReader } from '../src/api/modules/stats/stats.service.ts'
import type { Logger } from '../src/core/logger.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const sample: SiteStats = {
  totals: { server: 3, client: 1, cli: 0, skill: 5, loop: 0, agent: 0 },
  remote: 1,
  daily: [{ date: '2026-10-12', count: 2 }],
  publishedAt: '2026-10-12T06:00:00.000Z',
}

class CountingReader implements StatsReader {
  calls = 0
  async read() {
    this.calls++
    return sample
  }
}

describe('fillDays', () => {
  it('补齐空白日期，截止到最后一个有数据的日子', () => {
    expect(fillDays([{ date: '2026-10-10', count: 4 }, { date: '2026-10-12', count: 1 }], 4)).toEqual([
      { date: '2026-10-09', count: 0 },
      { date: '2026-10-10', count: 4 },
      { date: '2026-10-11', count: 0 },
      { date: '2026-10-12', count: 1 },
    ])
  })
  it('没有数据时返回空数组', () => {
    expect(fillDays([], 14)).toEqual([])
  })
})

describe('StatsService', () => {
  it('缓存有效期内不重复查询', async () => {
    let now = 0
    const reader = new CountingReader()
    const service = new StatsService(reader, () => now)
    await service.get()
    now += 60_000
    await service.get()
    expect(reader.calls).toBe(1)
    now += 11 * 60_000
    await service.get()
    expect(reader.calls).toBe(2)
  })
})

describe('GET /api/stats', () => {
  it('返回统计数据', async () => {
    const app = createApp({ entities: {}, logger: silent, stats: new StatsService(new CountingReader()) })
    const res = await app.request('/api/stats')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: sample })
  })
})

describe('fitsField', () => {
  it('只接受能排进一行的短名字', () => {
    expect(fitsField('playwright')).toBe(true)
    expect(fitsField('Brave Search')).toBe(true)
    expect(fitsField('ab')).toBe(false)
    expect(fitsField('a very long name with many words')).toBe(false)
    expect(fitsField('飞书 MCP')).toBe(false)
  })
})
