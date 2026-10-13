import { describe, expect, it } from 'vitest'
import { NO_POPULARITY, searchRows, type SearchSource } from '../src/search/rows.ts'

const source = (over: Partial<SearchSource> = {}): SearchSource => ({
  slug: 'postgres',
  name: 'PostgreSQL',
  tagline: 'Query Postgres databases',
  popularity: 120,
  featured: false,
  translations: { zh: '查询 Postgres 数据库', ja: 'Postgres データベースを照会', en: 'Query Postgres databases' },
  generated: [],
  ...over,
})

describe('搜索表的行', () => {
  it('每种语言一行：名称、slug、英文简介加上这种语言的译文，重复的片段只留一份', () => {
    const rows = searchRows('server', source())
    expect(rows.map((r) => r.locale)).toEqual(['zh', 'en', 'ja'])
    const body = Object.fromEntries(rows.map((r) => [r.locale, r.body]))
    expect(body.zh).toBe('PostgreSQL\npostgres\nQuery Postgres databases\n查询 Postgres 数据库')
    expect(body.en).toBe('PostgreSQL\npostgres\nQuery Postgres databases')
    expect(body.ja).toBe('PostgreSQL\npostgres\nQuery Postgres databases\nPostgres データベースを照会')
  })

  it('自撰简介不分语言都收录；缺少的字段跳过', () => {
    const [zh] = searchRows('loop', source({ name: null, tagline: null, translations: {}, generated: ['反复构建直到通过', 'Rebuild until green'] }))
    expect(zh!.body).toBe('postgres\n反复构建直到通过\nRebuild until green')
  })

  it('排序键与列表 sort=popular 一致：热度高的在前，没有热度的最后，热度相同时精选在前', () => {
    const rank = (over: Partial<SearchSource>) => {
      const [row] = searchRows('server', source(over))
      return [row!.popRank, row!.featuredRank, row!.slug] as const
    }
    const ordered = [rank({ slug: 'b', popularity: 500 }), rank({ slug: 'c', popularity: 10, featured: true }), rank({ slug: 'a', popularity: 10 }), rank({ slug: 'z', popularity: 0 }), rank({ slug: 'y', popularity: null, featured: true }), rank({ slug: 'x', popularity: null })]
    const sorted = [...ordered].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2].localeCompare(q[2]))
    expect(sorted).toEqual(ordered)
    expect(rank({ popularity: null })[0]).toBe(NO_POPULARITY)
  })

  it('指纹只在排序键或文字变化时改变，同步据此只改有变化的行', () => {
    const hashes = (over: Partial<SearchSource> = {}) => searchRows('server', source(over)).map((r) => r.rowHash)
    expect(hashes()).toEqual(hashes())
    const retranslated = hashes({ translations: { ...source().translations, zh: '查询 PostgreSQL 数据库' } })
    expect(retranslated[0]).not.toBe(hashes()[0])
    expect(retranslated.slice(1)).toEqual(hashes().slice(1))
    expect(hashes({ popularity: 121 })).not.toEqual(hashes())
  })
})
