import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import { letterOf, TagService, type TagCounts, type TagReader } from '../src/api/modules/tags/tag.service.ts'
import type { TagsQuery } from '../src/api/http/query.ts'
import type { Logger } from '../src/core/logger.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const sample: TagCounts = {
  rows: [
    { kind: 'server', tag: 'mcp', count: 40 },
    { kind: 'skill', tag: 'mcp', count: 2 },
    { kind: 'server', tag: 'python', count: 12 },
    { kind: 'skill', tag: 'python', count: 30 },
    { kind: 'server', tag: '3d', count: 1 },
    { kind: 'client', tag: '中文', count: 3 },
    { kind: 'server', tag: 'api', count: 12 },
  ],
  entries: { server: 50, skill: 31, client: 3 },
}

class CountingReader implements TagReader {
  calls = 0
  async read() {
    this.calls++
    return sample
  }
}

const query = (q: Partial<TagsQuery> = {}): TagsQuery => ({ q: undefined, sort: 'count', page: 1, pageSize: 300, ...q })

describe('letterOf', () => {
  it('a–z、0-9，其余归为 other', () => {
    expect([letterOf('mcp'), letterOf('3d'), letterOf('中文'), letterOf('-x')]).toEqual(['m', '0-9', 'other', 'other'])
  })
})

describe('TagService', () => {
  it('不限类型时合并各类型的计数，链接到条目最多的类型', async () => {
    const r = await new TagService(new CountingReader()).list(query())
    // 条目数相同时按名称
    expect(r.data).toEqual([
      { tag: 'mcp', count: 42, kind: 'server' },
      { tag: 'python', count: 42, kind: 'skill' },
      { tag: 'api', count: 12, kind: 'server' },
      { tag: '中文', count: 3, kind: 'client' },
      { tag: '3d', count: 1, kind: 'server' },
    ])
    expect(r.summary).toEqual({ tags: 5, common: 3, entries: 84, all: 5, kinds: { server: 4, client: 1, skill: 2 }, letters: { m: 1, p: 1, a: 1, other: 1, '0-9': 1 } })
    expect(r.meta).toEqual({ page: 1, pageSize: 300, total: 5, totalPages: 1 })
  })

  it('按类型、关键词、首字母筛选，按名称排序，分页', async () => {
    const service = new TagService(new CountingReader())
    const server = await service.list(query({ kind: 'server', sort: 'name' }))
    expect(server.data.map((t) => t.tag)).toEqual(['3d', 'api', 'mcp', 'python'])
    expect(server.summary).toMatchObject({ tags: 4, common: 3, entries: 50 })
    expect((await service.list(query({ q: 'PY' }))).data.map((t) => t.tag)).toEqual(['python'])
    // 首字母筛选不影响 summary 里的计数
    const m = await service.list(query({ letter: 'm' }))
    expect(m.data.map((t) => t.tag)).toEqual(['mcp'])
    expect(m.summary.tags).toBe(5)
    const page2 = await service.list(query({ pageSize: 2, page: 2 }))
    expect(page2.data.map((t) => t.tag)).toEqual(['api', '中文'])
    expect(page2.meta.totalPages).toBe(3)
    expect((await service.list(query({ kind: 'loop' }))).data).toEqual([])
  })

  it('缓存有效期内不重复查询', async () => {
    let now = 0
    const reader = new CountingReader()
    const service = new TagService(reader, () => now)
    await service.list(query())
    now += 60_000
    await service.list(query({ kind: 'server' }))
    expect(reader.calls).toBe(1)
  })
})

describe('GET /api/tags', () => {
  const app = createApp({ entities: {}, logger: silent, tags: new TagService(new CountingReader()) })

  it('返回标签列表', async () => {
    const res = await app.request('/api/tags?kind=skill&pageSize=1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[]; meta: { total: number } }
    expect(body.data).toEqual([{ tag: 'python', count: 30, kind: 'skill' }])
    expect(body.meta.total).toBe(2)
  })

  it('参数不合法时返回 400', async () => {
    expect((await app.request('/api/tags?kind=foo')).status).toBe(400)
    expect((await app.request('/api/tags?letter=ab')).status).toBe(400)
  })
})
