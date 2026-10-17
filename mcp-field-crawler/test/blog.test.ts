import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { BlogCard, BlogListQuery, BlogPostFull, BlogRepository } from '../src/api/modules/blog/blog.repository.ts'
import { BlogService, summarize, type BlogList, type BlogPostDetail } from '../src/api/modules/blog/blog.service.ts'
import { extractMentionTargets, normalizeTags, readingMinutes } from '../src/blog/post.ts'
import type { Logger } from '../src/core/logger.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const card = (slug: string, over: Partial<BlogCard> = {}): BlogCard => ({
  slug,
  title: slug,
  summary: '',
  category: 'tutorial',
  tags: [],
  coverUrl: null,
  authorName: 'MCP Field',
  pinned: false,
  views: 0,
  readingMinutes: 1,
  publishedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

describe('文章工具函数', () => {
  it('阅读时长：中文每分钟 400 字、英文每分钟 200 词，至少 1 分钟', () => {
    expect(readingMinutes('短')).toBe(1)
    expect(readingMinutes('字'.repeat(2000))).toBe(5)
    expect(readingMinutes(Array(600).fill('word').join(' '))).toBe(3)
    // 图片和链接地址不算字数
    expect(readingMinutes(`![${'图'.repeat(10)}](https://x.com/${'a'.repeat(5000)})`)).toBe(1)
  })

  it('从正文链接解析站内条目：相对地址、带语言前缀、完整地址都认，去重，代码块里的不算', () => {
    const md = [
      '看看 [Linear](/servers/linear) 和 [GitHub](https://mcpfield.com/en/servers/github?tab=tools)',
      '再提一次 [Linear](/servers/linear)，以及 [Claude Code](https://www.mcpfield.com/clients/claude-code)',
      '```md\n[假的](/skills/fake)\n```',
      '[标签页](/tags) [外站](https://example.com/servers/x) [Skill](/ja/skills/pdf%20tools)',
    ].join('\n')
    expect(extractMentionTargets(md)).toEqual([
      { kind: 'server', slug: 'linear' },
      { kind: 'server', slug: 'github' },
      { kind: 'client', slug: 'claude-code' },
      { kind: 'skill', slug: 'pdf tools' },
    ])
    expect(extractMentionTargets(md, 2)).toHaveLength(2)
  })

  it('标签去掉 #、转小写、去重，最多 8 个', () => {
    expect(normalizeTags([' #MCP ', 'mcp', '', 'Claude-Code'])).toEqual(['mcp', 'claude-code'])
    expect(normalizeTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8)
  })
})

describe('BlogService', () => {
  it('汇总栏目计数、置顶、热门和常用标签', () => {
    const s = summarize([
      card('a', { category: 'product', tags: ['mcp', 'admin'], views: 5, publishedAt: '2026-10-12T00:00:00.000Z' }),
      card('b', { tags: ['mcp'], views: 20, pinned: true, publishedAt: '2026-10-09T00:00:00.000Z' }),
      card('c', { category: 'case', views: 1, publishedAt: '2026-10-01T00:00:00.000Z' }),
    ])
    expect(s.total).toBe(3)
    expect(s.categories).toEqual({ product: 1, tutorial: 1, ecosystem: 0, testing: 0, case: 1 })
    expect(s.latestAt).toBe('2026-10-12T00:00:00.000Z')
    expect(s.pinned?.slug).toBe('b')
    expect(s.popular.map((p) => p.slug)).toEqual(['b', 'a', 'c'])
    expect(s.tags).toEqual([
      { tag: 'mcp', count: 2 },
      { tag: 'admin', count: 1 },
    ])
  })

  class FakeRepo implements BlogRepository {
    posts = [card('newest', { publishedAt: '2026-10-12T00:00:00.000Z' }), card('middle', { publishedAt: '2026-10-09T00:00:00.000Z' }), card('oldest')]
    views = 0
    async list(q: BlogListQuery) {
      return { rows: this.posts.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: this.posts.length }
    }
    async all() {
      return this.posts
    }
    async find(slug: string): Promise<BlogPostFull | null> {
      const p = this.posts.find((x) => x.slug === slug)
      return p ? { ...p, body: '# hi', mentions: [] } : null
    }
    async neighbors(post: BlogCard) {
      const i = this.posts.findIndex((p) => p.slug === post.slug)
      return { newer: this.posts[i - 1] ?? null, older: this.posts[i + 1] ?? null }
    }
    async related(post: BlogCard, limit: number) {
      return this.posts.filter((p) => p.slug !== post.slug).slice(0, limit)
    }
    async addView() {
      this.views++
      return true
    }
  }

  const app = (repo = new FakeRepo()) => createApp({ entities: {}, blog: new BlogService(repo), logger: silent })

  it('列表带分页和汇总；文章带上一篇、下一篇和相关文章', async () => {
    const list = (await (await app().request('/api/blog/posts?pageSize=2')).json()) as BlogList
    expect(list.data.map((p) => p.slug)).toEqual(['newest', 'middle'])
    expect(list.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 })
    expect(list.summary.total).toBe(3)

    const post = ((await (await app().request('/api/blog/posts/middle')).json()) as { data: BlogPostDetail }).data
    expect(post.body).toBe('# hi')
    expect(post.newer).toEqual({ slug: 'newest', title: 'newest' })
    expect(post.older).toEqual({ slug: 'oldest', title: 'oldest' })
    expect(post.related.map((p) => p.slug)).toEqual(['newest', 'oldest'])
  })

  it('不存在或地址不合法的文章返回 404；浏览数接口返回 204', async () => {
    const repo = new FakeRepo()
    expect((await app(repo).request('/api/blog/posts/nope')).status).toBe(404)
    expect((await app(repo).request('/api/blog/posts/Bad_Slug')).status).toBe(404)
    expect((await app(repo).request('/api/blog/posts?category=unknown')).status).toBe(400)
    expect((await app(repo).request('/api/blog/posts/middle/views', { method: 'POST' })).status).toBe(204)
    expect(repo.views).toBe(1)
  })
})
