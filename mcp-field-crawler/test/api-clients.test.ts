import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { ListQuery } from '../src/api/http/query.ts'
import { EntityService } from '../src/api/modules/entities/entity.service.ts'
import { PRESENTERS } from '../src/api/modules/entities/presenters.ts'
import type { CategoryCount, EntityReadRepository, EntityRow, TypeCount } from '../src/api/repositories/types.ts'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import type { Logger } from '../src/core/logger.ts'
import { sourceHash } from '../src/translate/key.ts'
import { readmeHash } from '../src/readme/chunk.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

function row(slug: string, stars: number, category: string | null): EntityRow<'client'> {
  const draft = new DraftBuilder(
    { kind: 'client', sourceId: 'mcpso', externalId: slug, sourceUrl: `https://mcp.so/clients/${slug}`, slug, name: slug.toUpperCase() },
    { clientType: 'ide' },
  )
    .identity({ repository: parseRepositoryUrl(`https://github.com/acme/${slug}`) })
    .text('tagline', 'en', `${slug} tagline`)
    .text('readme', 'en', '# readme', 'markdown')
    .link('repository', `https://github.com/acme/${slug}`)
    .category(category, category ?? 'other')
    .metric('github_stars', stars)
    .build()
  return { draft, fetchedAt: '2026-10-10T00:00:00.000Z', mappedAt: '2026-10-10T00:00:01.000Z' }
}

/** 内存版仓储：验证业务层和路由不依赖数据库 */
class FakeRepository implements EntityReadRepository<'client'> {
  lastQuery?: ListQuery
  constructor(private readonly data: EntityRow<'client'>[]) {}
  async list(query: ListQuery) {
    this.lastQuery = query
    const start = (query.page - 1) * query.pageSize
    return { rows: this.data.slice(start, start + query.pageSize), total: this.data.length }
  }
  async findBySlug(slug: string) {
    return this.data.find((r) => r.draft.slug === slug) ?? null
  }
  async typeCounts(): Promise<TypeCount[]> {
    return []
  }
  async sitemap(offset: number, limit: number) {
    return { rows: this.data.slice(offset, offset + limit).map((r) => ({ slug: r.draft.slug, updatedAt: r.draft.sourceUpdatedAt ?? null })), total: this.data.length }
  }
  async viewCounts() {
    return { official: 0, featured: 1, verified: 2 }
  }
  async categoryCounts(): Promise<CategoryCount[]> {
    return [
      { slug: 'ide', sourceValue: 'ide', count: 2 },
      { slug: null, sourceValue: 'other', count: 1 },
      { slug: 'ide', sourceValue: 'editor', count: 1 },
    ]
  }
}

/** 内存版翻译记忆库：只有 zed 的简介有中文译文 */
const translations = {
  async lookup(hashes: string[], locale: string) {
    const zh = new Map([[sourceHash('zed tagline'), '高性能编辑器']])
    return locale === 'zh' ? new Map(hashes.filter((h) => zh.has(h)).map((h) => [h, zh.get(h)!])) : new Map<string, string>()
  },
}

/** 内存版介绍：只有 zed 有，且只有英文 */
const overviews = {
  async find(ref: { externalId: string }, _locale: string) {
    if (ref.externalId !== 'zed') return null
    return { locale: 'en' as const, summary: 'A fast editor.', features: ['Fast'], useCases: ['Coding'], mcp: '', status: 'ok', model: 'fake', generatedAt: new Date('2026-10-10T00:00:00Z') }
  },
}

/** 内存版 README 译文：zed 有中文译文，翻译时的原文指纹与当前一致 */
const readmes = {
  async find(ref: { externalId: string }, locale: string) {
    if (ref.externalId !== 'zed' || locale !== 'zh') return null
    return { locale: 'zh' as const, readmeHash: readmeHash('# readme'), content: '# 说明', status: 'ok', models: 'fake', license: 'MIT', translatedAt: new Date('2026-10-10T00:00:00Z') }
  },
}

/** 内存版 GitHub README：只抓到了 zed 的 */
const githubReadmeOf = (content: string) => ({
  find: async (keys: string[]) => new Map(keys.filter((k) => k === 'repo:github.com/acme/zed').map((k) => [k, { repository: 'Acme/Zed', path: 'README.md', sha: 's', format: 'markdown' as const, content }])),
})
const githubReadmes = githubReadmeOf('# readme')

function setup() {
  const repo = new FakeRepository([row('zed', 100, 'ide'), row('cline', 50, 'agent'), row('misc', 1, null)])
  const app = createApp({ entities: { client: new EntityService('client', repo, PRESENTERS.client, { translations, overviews, readmes, githubReadmes }) }, logger: silent })
  return { app, repo }
}

describe('GET /api/clients', () => {
  it('返回分页列表，列表项不含 README', async () => {
    const { app, repo } = setup()
    const res = await app.request('/api/clients?page=1&pageSize=2&sort=name&featured=true')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Record<string, unknown>[]; meta: unknown }
    expect(body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2, locale: 'en' })
    expect(body.data[0]).toMatchObject({
      slug: 'zed',
      tagline: 'zed tagline',
      stars: 100,
      category: { slug: 'ide', source: 'ide' },
      links: { repository: 'https://github.com/acme/zed', website: null, docs: null },
    })
    expect(body.data[0]).not.toHaveProperty('readme')
    expect(repo.lastQuery).toMatchObject({ sort: 'name', featured: true })
  })

  it('参数不合法时返回 400 和字段错误', async () => {
    const { app } = setup()
    const res = await app.request('/api/clients?pageSize=500&sort=hot&category=Bad Value')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { field: string }[] } }
    expect(body.error.code).toBe('bad_request')
    expect(body.error.details.map((d) => d.field).sort()).toEqual(['category', 'pageSize', 'sort'])
  })
})

describe('GET /api/clients/:slug', () => {
  it('返回详情，包含 README、来源和问题列表', async () => {
    const { app } = setup()
    const res = await app.request('/api/clients/zed')
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({
      identityKey: 'repo:github.com/acme/zed',
      readme: { format: 'markdown', content: '# readme' },
      source: { id: 'mcpso', url: 'https://mcp.so/clients/zed' },
      issues: [],
    })
  })

  it('不存在时返回 404', async () => {
    const { app } = setup()
    const res = await app.request('/api/clients/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: '客户端 "nope" 不存在' } })
  })
})

describe('GET /api/clients/categories', () => {
  it('按 mcp-field 分类汇总，并列出对应的源站分类', async () => {
    const { app } = setup()
    const body = (await (await app.request('/api/clients/categories')).json()) as { data: unknown; meta: unknown }
    expect(body).toEqual({
      data: [
        { slug: 'ide', count: 3, sources: [{ value: 'ide', count: 2 }, { value: 'editor', count: 1 }] },
        { slug: null, count: 1, sources: [{ value: 'other', count: 1 }] },
      ],
      meta: { total: 4 },
    })
  })
})

describe('GET /api/clients/facets', () => {
  it('一次返回总数、精选/已认证数量和分类计数', async () => {
    const { app } = setup()
    const body = (await (await app.request('/api/clients/facets')).json()) as { data: { total: number; views: unknown; categories: unknown[] } }
    expect(body.data.total).toBe(4)
    expect(body.data.views).toEqual({ official: 0, featured: 1, verified: 2 })
    expect(body.data.categories).toHaveLength(2)
  })
})

describe('简介本地化', () => {
  it('locale=zh 时返回译文，没有译文的保留原文', async () => {
    const { app } = setup()
    const body = (await (await app.request('/api/clients?locale=zh')).json()) as { data: { slug: string; tagline: string; taglineLocale: string | null }[]; meta: { locale: string } }
    expect(body.meta.locale).toBe('zh')
    expect(body.data.find((c) => c.slug === 'zed')).toMatchObject({ tagline: '高性能编辑器', taglineLocale: 'zh' })
    expect(body.data.find((c) => c.slug === 'cline')).toMatchObject({ tagline: 'cline tagline', taglineLocale: null })
  })

  it('详情同时返回译文和原文', async () => {
    const { app } = setup()
    const body = (await (await app.request('/api/clients/zed?locale=zh')).json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({ tagline: '高性能编辑器', taglineOriginal: 'zed tagline', taglineLocale: 'zh' })
  })

  it('不支持的语言返回 400', async () => {
    const { app } = setup()
    expect((await app.request('/api/clients?locale=fr')).status).toBe(400)
  })
})

describe('AI 介绍', () => {
  it('详情返回介绍；请求的语言没有时退回英文，并标明实际语言', async () => {
    const { app } = setup()
    const zed = (await (await app.request('/api/clients/zed?locale=ja')).json()) as { data: { overview: unknown } }
    expect(zed.data.overview).toEqual({ locale: 'en', summary: 'A fast editor.', features: ['Fast'], useCases: ['Coding'], mcp: null, model: 'fake', generatedAt: '2026-10-10T00:00:00.000Z' })
    const cline = (await (await app.request('/api/clients/cline')).json()) as { data: { overview: unknown } }
    expect(cline.data.overview).toBeNull()
  })
})

describe('README 译文', () => {
  it('中文请求返回译文和原文更新标记；英文不返回译文', async () => {
    const { app } = setup()
    const zh = (await (await app.request('/api/clients/zed?locale=zh')).json()) as { data: { readmeTranslation: unknown; readme: unknown } }
    expect(zh.data.readmeTranslation).toEqual({ locale: 'zh', content: '# 说明', outdated: false, status: 'ok', models: ['fake'], license: 'MIT', translatedAt: '2026-10-10T00:00:00.000Z' })
    expect(zh.data.readme).toEqual({ format: 'markdown', content: '# readme', baseUrl: 'https://github.com/Acme/Zed/blob/HEAD/' })
    const en = (await (await app.request('/api/clients/zed?locale=en')).json()) as { data: { readmeTranslation: unknown } }
    expect(en.data.readmeTranslation).toBeNull()
  })

  it('只用 GitHub 的 README：没抓到时即使草稿里有源站收录的也不返回', async () => {
    const { app } = setup()
    const cline = (await (await app.request('/api/clients/cline?locale=zh')).json()) as { data: { readme: unknown; readmeTranslation: unknown } }
    expect(cline.data.readme).toBeNull()
    expect(cline.data.readmeTranslation).toBeNull()
  })

  it('星数、最近提交时间用 GitHub 的；没抓到的保留源站的', async () => {
    const githubRepos = {
      find: async (keys: string[]) =>
        new Map(keys.filter((k) => k === 'repo:github.com/acme/zed').map((k) => [k, { repository: 'Acme/Zed', stars: 999, forks: 1, archived: false, lastCommitAt: '2026-10-11T00:00:00Z', pushedAt: null }])),
    }
    const app = createApp({ entities: { client: new EntityService('client', new FakeRepository([row('zed', 10, 'ide'), row('cline', 50, 'agent')]), PRESENTERS.client, { githubRepos }) }, logger: silent })
    const list = (await (await app.request('/api/clients')).json()) as { data: { slug: string; stars: number; lastCommitAt: string | null }[] }
    expect(list.data.find((c) => c.slug === 'zed')).toMatchObject({ stars: 999, lastCommitAt: '2026-10-11T00:00:00Z' })
    expect(list.data.find((c) => c.slug === 'cline')).toMatchObject({ stars: 50 })
    const zed = (await (await app.request('/api/clients/zed')).json()) as { data: { stars: number } }
    expect(zed.data.stars).toBe(999)
  })

  it('GitHub README 更新后，译文标记为过期', async () => {
    const app = createApp({ entities: { client: new EntityService('client', new FakeRepository([row('zed', 10, 'ide')]), PRESENTERS.client, { readmes, githubReadmes: githubReadmeOf('# readme v2') }) }, logger: silent })
    const zh = (await (await app.request('/api/clients/zed?locale=zh')).json()) as { data: { readmeTranslation: { outdated: boolean } } }
    expect(zh.data.readmeTranslation.outdated).toBe(true)
  })
})
