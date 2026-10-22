import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { BlogCard, BlogListQuery, BlogPostFull, BlogRepository } from '../src/api/modules/blog/blog.repository.ts'
import { BlogService, summarize, type BlogList, type BlogPostDetail } from '../src/api/modules/blog/blog.service.ts'
import { blogSourceHash, extractMentionTargets, normalizeTags } from '../src/blog/post.ts'
import { BlogTranslationError, BlogTranslator, validateBlogChunk } from '../src/blog/translate.ts'
import { cleanSlug, directionGuide, imageMarkers, resolveImages } from '../src/blog/generate.ts'
import { interleave, searchTerms } from '../src/blog/materials.ts'
import { maskKey } from '../src/admin-api/settings.ts'
import { postUrl } from '../src/blog/indexnow.ts'
import type { Llm } from '../src/llm/provider.ts'
import type { Logger } from '../src/core/logger.ts'
import type { Locale } from '../src/core/types.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const card = (slug: string, over: Partial<BlogCard> = {}): BlogCard => ({
  slug,
  title: slug,
  summary: '',
  tags: [],
  coverUrl: null,
  authorName: 'MCP Field',
  pinned: false,
  publishedAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  locale: 'zh',
  translations: [],
  ...over,
})

describe('文章工具函数', () => {
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
  it('汇总置顶和常用标签', () => {
    const s = summarize([
      card('a', { tags: ['mcp', 'admin'], publishedAt: '2026-10-12T00:00:00.000Z' }),
      card('b', { tags: ['mcp'], pinned: true, publishedAt: '2026-10-09T00:00:00.000Z' }),
      card('c', { publishedAt: '2026-10-01T00:00:00.000Z' }),
    ])
    expect(s.total).toBe(3)
    expect(s.tagCount).toBe(2)
    expect(s.latestAt).toBe('2026-10-12T00:00:00.000Z')
    expect(s.pinned?.slug).toBe('b')
    expect(s.tags).toEqual([
      { tag: 'mcp', count: 2 },
      { tag: 'admin', count: 1 },
    ])
  })

  class FakeRepo implements BlogRepository {
    posts = [card('newest', { publishedAt: '2026-10-12T00:00:00.000Z' }), card('middle', { publishedAt: '2026-10-09T00:00:00.000Z' }), card('oldest')]
    async list(q: BlogListQuery) {
      return { rows: this.posts.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: this.posts.length }
    }
    async all() {
      return this.posts
    }
    async find(slug: string, locale: Locale): Promise<BlogPostFull | null> {
      const p = this.posts.find((x) => x.slug === slug)
      if (!p) return null
      // 只有英文译文
      return locale === 'en' ? { ...p, title: `${p.title} (en)`, locale: 'en', body: '# hello', mentions: [], translation: { outdated: true, translatedAt: null } } : { ...p, body: '# hi', mentions: [], translation: null }
    }
    async neighbors(post: BlogCard) {
      const i = this.posts.findIndex((p) => p.slug === post.slug)
      return { newer: this.posts[i - 1] ?? null, older: this.posts[i + 1] ?? null }
    }
    async related(post: BlogCard, limit: number) {
      return this.posts.filter((p) => p.slug !== post.slug).slice(0, limit)
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

  it('按请求语言返回译文，没有译文的语言回落到中文原文', async () => {
    const en = ((await (await app().request('/api/blog/posts/middle?locale=en')).json()) as { data: BlogPostDetail }).data
    expect([en.title, en.locale, en.body, en.translation]).toEqual(['middle (en)', 'en', '# hello', { outdated: true, translatedAt: null }])
    const ja = ((await (await app().request('/api/blog/posts/middle?locale=ja')).json()) as { data: BlogPostDetail }).data
    expect([ja.title, ja.locale, ja.body, ja.translation]).toEqual(['middle', 'zh', '# hi', null])
    expect((await app().request('/api/blog/posts/middle?locale=fr')).status).toBe(400)
  })

  it('不存在或地址不合法的文章返回 404；浏览数接口已删除', async () => {
    const repo = new FakeRepo()
    expect((await app(repo).request('/api/blog/posts/nope')).status).toBe(404)
    expect((await app(repo).request('/api/blog/posts/Bad_Slug')).status).toBe(404)
    expect((await app(repo).request('/api/blog/posts?pageSize=500')).status).toBe(400)
    expect((await app(repo).request('/api/blog/posts/middle/views', { method: 'POST' })).status).toBe(404)
  })
})

describe('博客翻译', () => {
  const source = {
    title: '远程 MCP 服务接入指南',
    summary: '十分钟接入远程服务。',
    body: ['## 准备工作', '', '先安装 [Claude Code](/clients/claude-code)，然后运行 `claude mcp add`。', '', '```bash', '# 这行注释不翻译', 'claude mcp add linear', '```', '', '## 第二步', '', '完成授权。', ''].join('\n'),
  }

  /** 假模型：把中文换成 [en]，其余原样返回；calls 记录每次请求 */
  function fakeLlm(transform: (input: string) => string = (s) => s.replace(/[一-鿿，。、：]+/g, '[en]')) {
    const calls: string[] = []
    const llm: Llm = {
      provider: 'openai',
      tool: () => Promise.reject(new Error('不用')),
      text: async (p) => {
        calls.push(p.input)
        const text = p.input.startsWith('<title>') ? transform(p.input) : transform(p.input.replace(/^<source>\n|\n<\/source>$/g, ''))
        return { text, usage: { requests: 1, inputTokens: 0, outputTokens: 0 } }
      },
    }
    return { llm, calls }
  }

  it('代码块原样保留，正文逐段翻译；原文没变的片段下次直接沿用', async () => {
    const { llm, calls } = fakeLlm()
    const t = new BlogTranslator(llm, 'm', silent, { maxChunkChars: 60 })
    const first = await t.translate(source, 'en')
    expect(first.title).toBe('[en] MCP [en]')
    expect(first.summary).toBe('[en]')
    expect(first.body).toContain('```bash\n# 这行注释不翻译\nclaude mcp add linear\n```')
    expect(first.body).toContain('## [en]\n\n[en] [Claude Code](/clients/claude-code)[en] `claude mcp add`[en]')
    expect(first.body.split('\n').length).toBe(source.body.split('\n').length)
    // 第一节的标题、段落各一段，第二节一段
    expect(first.translatedChunks).toBe(3)

    calls.length = 0
    const second = await t.translate({ ...source, body: source.body.replace('完成授权。', '完成授权并测试。') }, 'en', first.chunks)
    // 标题摘要一次 + 改动的那一段一次
    expect(calls).toHaveLength(2)
    expect(second.translatedChunks).toBe(1)
  })

  it('译文丢了占位符或链接、残留中文时重试，始终不合格就报错', async () => {
    expect(validateBlogChunk('看 [文档](https://a.dev)\n⟦CODE 0⟧', 'See the docs', 'en').map((p) => p.code)).toEqual(['placeholder_mismatch', 'missing_url'])
    expect(validateBlogChunk('这是一段很长的中文说明文字内容', '这是一段很长的中文说明文字内容', 'en').map((p) => p.code)).toEqual(['chinese_left'])
    expect(validateBlogChunk('这是说明', 'これは说明这个们です', 'ja').some((p) => p.code === 'chinese_in_ja')).toBe(true)

    const { llm, calls } = fakeLlm((s) => (s.startsWith('<title>') ? '<title>T</title><summary>S</summary>' : 'dropped everything'))
    await expect(new BlogTranslator(llm, 'm', silent, { attempts: 2 }).translate(source, 'en')).rejects.toBeInstanceOf(BlogTranslationError)
    // 标题摘要 1 次 + 第一段 2 次（并发时第二段也可能已经开始）
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('原文指纹：标题、摘要、正文任何一处变化都会改变', () => {
    const h = blogSourceHash(source)
    expect(blogSourceHash({ ...source })).toBe(h)
    expect(blogSourceHash({ ...source, title: 'x' })).not.toBe(h)
    expect(blogSourceHash({ ...source, body: source.body.replace(/\n/g, '\r\n') })).toBe(h)
  })
})

describe('博客 AI 生成', () => {
  it('插图占位：成功的回填成图片（不带图注），失败的整行删掉', async () => {
    const body = ['开头一段。', '', '![架构示意](image: a diagram of agents calling tools)', '', '中间一段。', '![第二张](image:  server room )', '', '结尾。'].join('\n')
    expect(imageMarkers(body).map((m) => [m.alt, m.prompt])).toEqual([
      ['架构示意', 'a diagram of agents calling tools'],
      ['第二张', 'server room'],
    ])
    const events: (string | null)[] = []
    const { body: out, failed } = await resolveImages(
      body,
      async (prompt) => {
        if (prompt === 'server room') throw new Error('没有找到')
        return { url: 'https://assets.mcpfield.com/blog/a.webp' }
      },
      (e) => events.push(e.markdown),
    )
    // 不写图片标题：插图下方不显示图注
    expect(out).toBe(['开头一段。', '', '![架构示意](https://assets.mcpfield.com/blog/a.webp)', '', '中间一段。', '', '结尾。'].join('\n'))
    expect(failed).toEqual(['第二张：没有找到'])
    expect(events).toEqual(['![架构示意](https://assets.mcpfield.com/blog/a.webp)', null])
  })

  it('模型给的地址整理成合法 slug；预设方向换成写法说明，自定义方向原样保留', () => {
    expect(cleanSlug('Postgres MCP Tools: Comparison 2026!')).toBe('postgres-mcp-tools-comparison-2026')
    expect(cleanSlug('数据库')).toBe('')
    expect(directionGuide('tutorial')).toContain('上手教程')
    expect(directionGuide('  给产品经理讲 MCP  ')).toBe('给产品经理讲 MCP')
  })

  it('站内素材的搜索词：关键词全要，标题只取英文技术名，去掉太常见的词', () => {
    expect(searchTerms('远程服务, OAuth', '10 分钟在 Claude Code 里接入第一个远程 MCP 服务')).toEqual(['远程服务', 'oauth', 'claude', 'code'])
    expect(searchTerms('mcp、postgres；数据库')).toEqual(['postgres', '数据库'])
    expect(searchTerms(undefined, '纯中文标题')).toEqual([])
    expect(searchTerms('REA, 逆向工程, CLI')).toEqual(['rea', '逆向工程'])
    // 关键词不按空格拆：多词名称整体去搜
    expect(searchTerms('Codebase  Memory, token 消耗')).toEqual(['codebase memory', 'token 消耗'])
  })

  it('站内素材按搜索词轮流取：前面的词不会被热门的泛词挤掉', () => {
    expect(interleave([['rea'], ['c', 'a', 'b'], ['x']], 4)).toEqual(['rea', 'c', 'x', 'a'])
    expect(interleave([[], ['a']], 3)).toEqual(['a'])
  })

  it('API Key 只回显头尾几位', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('short')).toBe('••••')
    expect(maskKey('sk-1234567890abcdef')).toBe('sk-1…cdef')
  })
})

describe('博客 IndexNow', () => {
  it('文章地址：中文没有语言前缀，英文日文带前缀', () => {
    expect(postUrl('https://mcpfield.com', 'a-post')).toBe('https://mcpfield.com/blog/a-post')
    expect(postUrl('https://mcpfield.com', 'a-post', 'en')).toBe('https://mcpfield.com/en/blog/a-post')
    expect(postUrl('https://mcpfield.com', 'a-post', 'ja')).toBe('https://mcpfield.com/ja/blog/a-post')
  })
})
