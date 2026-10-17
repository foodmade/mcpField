import type { Locale } from '../../../core/types.ts'
import { pageMeta, type PageMeta } from '../../http/query.ts'
import { TtlCache } from '../../http/ttl-cache.ts'
import type { BlogCard, BlogListQuery, BlogPostFull, BlogRepository } from './blog.repository.ts'

export interface BlogSummary {
  /** 已发布文章总数（不受筛选影响，下同） */
  total: number
  /** 最近一篇的发布时间 */
  latestAt: string | null
  /** 置顶文章：没有置顶时为空 */
  pinned: BlogCard | null
  /** 最常用的标签 */
  tags: { tag: string; count: number }[]
  /** 用到的标签总数 */
  tagCount: number
}

export interface BlogList {
  data: BlogCard[]
  meta: PageMeta
  summary: BlogSummary
}

export interface BlogPostDetail extends BlogPostFull {
  older: Pick<BlogCard, 'slug' | 'title'> | null
  newer: Pick<BlogCard, 'slug' | 'title'> | null
  related: BlogCard[]
}

const TOP_TAGS = 12
const RELATED = 3

export function summarize(posts: BlogCard[]): BlogSummary {
  const tags = new Map<string, number>()
  for (const p of posts) {
    for (const t of p.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
  }
  return {
    total: posts.length,
    latestAt: posts[0]?.publishedAt ?? null,
    pinned: posts.find((p) => p.pinned) ?? null,
    tagCount: tags.size,
    tags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_TAGS).map(([tag, count]) => ({ tag, count })),
  }
}

const pick = (p: BlogCard | null) => (p ? { slug: p.slug, title: p.title } : null)

/**
 * 网站的博客读接口。文章在后台（另一个进程）保存，这里没法收到通知，结果只缓存 30 秒：保存后最多半分钟网站可见。
 */
export class BlogService {
  private readonly lists = new TtlCache<BlogList>(30_000, 100)
  private readonly posts = new TtlCache<BlogPostDetail | null>(30_000, 300)
  private readonly everything = new TtlCache<BlogCard[]>(30_000, 3)

  constructor(
    private readonly repo: BlogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(query: BlogListQuery): Promise<BlogList> {
    return this.lists.get(JSON.stringify(query), async () => {
      const now = this.now()
      const [{ rows, total }, all] = await Promise.all([this.repo.list(query, now), this.all(query.locale)])
      return { data: rows, meta: pageMeta(query, total), summary: summarize(all) }
    })
  }

  get(slug: string, locale: Locale): Promise<BlogPostDetail | null> {
    return this.posts.get(`${locale}:${slug}`, async () => {
      const now = this.now()
      const post = await this.repo.find(slug, locale, now)
      if (!post) return null
      const [{ older, newer }, related] = await Promise.all([this.repo.neighbors(post, locale, now), this.repo.related(post, RELATED, locale, now)])
      return { ...post, older: pick(older), newer: pick(newer), related }
    })
  }

  /** sitemap 和 RSS：全部已发布文章（不带正文），标题按请求语言 */
  all(locale: Locale): Promise<BlogCard[]> {
    return this.everything.get(locale, () => this.repo.all(locale, this.now()))
  }
}
