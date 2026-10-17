import { and, desc, eq, gt, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/mysql-core'
import { blogSourceHash, type BlogMention } from '../../../blog/post.ts'
import type { Locale } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { blogPosts, blogPostTranslations } from '../../../db/schema/index.ts'

/** 列表里的一篇文章（不带正文）；标题、摘要是请求语言的译文，没有译文时是中文原文 */
export interface BlogCard {
  slug: string
  title: string
  summary: string
  tags: string[]
  coverUrl: string | null
  authorName: string
  pinned: boolean
  publishedAt: string
  updatedAt: string
  /** 标题、摘要实际用的语言：请求语言没有译文时是 zh */
  locale: Locale
  /** 已有译文的语言（不含原文 zh） */
  translations: Locale[]
}

export interface BlogPostFull extends BlogCard {
  /** Markdown 正文（请求语言的译文，没有时是中文原文） */
  body: string
  mentions: BlogMention[]
  /** 显示的是译文时：译文对应的是不是旧版原文（原文改过、新译文还没翻完） */
  translation: { outdated: boolean; translatedAt: string | null } | null
}

export interface BlogListQuery {
  tag?: string
  q?: string
  page: number
  pageSize: number
  locale: Locale
}

export interface BlogRepository {
  list(query: BlogListQuery, now: Date): Promise<{ rows: BlogCard[]; total: number }>
  /** 全部已发布文章的栏目、标签、浏览数，汇总侧栏和 sitemap 用（文章不多，直接取全部） */
  all(locale: Locale, now: Date): Promise<BlogCard[]>
  find(slug: string, locale: Locale, now: Date): Promise<BlogPostFull | null>
  /** 发布时间上相邻的两篇：older 更早的一篇，newer 更新的一篇 */
  neighbors(post: BlogCard, locale: Locale, now: Date): Promise<{ older: BlogCard | null; newer: BlogCard | null }>
  related(post: BlogCard, limit: number, locale: Locale, now: Date): Promise<BlogCard[]>
}

/** 请求语言的译文（只连有译文内容的行）；请求中文时连不上任何行，字段都回落到原文 */
const tr = alias(blogPostTranslations, 'tr')
const joinTranslation = (locale: Locale) => and(eq(tr.postId, blogPosts.id), sql`${tr.locale} = ${locale}`, isNotNull(tr.contentHash))

const cardColumns = (locale: Locale) => ({
  slug: blogPosts.slug,
  title: sql<string>`COALESCE(${tr.title}, ${blogPosts.title})`,
  summary: sql<string>`COALESCE(${tr.summary}, ${blogPosts.summary})`,
  tags: blogPosts.tags,
  coverUrl: blogPosts.coverUrl,
  authorName: blogPosts.authorName,
  pinned: blogPosts.pinned,
  publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt,
  locale: sql<Locale>`IF(${tr.id} IS NULL, 'zh', ${locale})`,
  translations: sql<string | null>`(SELECT GROUP_CONCAT(x.locale ORDER BY x.locale) FROM blog_post_translations x WHERE x.post_id = ${blogPosts.id} AND x.content_hash IS NOT NULL)`,
})

type CardRow = Omit<BlogCard, 'publishedAt' | 'updatedAt' | 'translations'> & { publishedAt: Date | null; updatedAt: Date; translations: string | null }

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

const toCard = (r: CardRow): BlogCard => ({
  ...r,
  tags: json<string[]>(r.tags),
  pinned: Boolean(r.pinned),
  publishedAt: r.publishedAt!.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  translations: r.translations ? (r.translations.split(',') as Locale[]) : [],
})

/** 网站上看得到的：已发布且发布时间已到 */
const visible = (now: Date) => and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, now))!

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export class MysqlBlogRepository implements BlogRepository {
  constructor(private readonly db: Db) {}

  private cards(locale: Locale) {
    return this.db.select(cardColumns(locale)).from(blogPosts).leftJoin(tr, joinTranslation(locale))
  }

  async list(query: BlogListQuery, now: Date) {
    const conditions: SQL[] = [visible(now)]
    if (query.tag) conditions.push(sql`JSON_CONTAINS(${blogPosts.tags}, JSON_QUOTE(${query.tag}))`)
    // 关键词同时搜原文和请求语言的译文
    if (query.q) {
      const like = likeOf(query.q)
      conditions.push(or(sql`${blogPosts.title} LIKE ${like}`, sql`${blogPosts.summary} LIKE ${like}`, sql`${tr.title} LIKE ${like}`, sql`${tr.summary} LIKE ${like}`)!)
    }
    const where = and(...conditions)
    const [rows, [count]] = await Promise.all([
      this.cards(query.locale)
        .where(where)
        .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: sql<number>`COUNT(*)` }).from(blogPosts).leftJoin(tr, joinTranslation(query.locale)).where(where),
    ])
    return { rows: rows.map(toCard), total: Number(count?.n ?? 0) }
  }

  async all(locale: Locale, now: Date) {
    const rows = await this.cards(locale).where(visible(now)).orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
    return rows.map(toCard)
  }

  async find(slug: string, locale: Locale, now: Date) {
    const [row] = await this.db
      .select({
        ...cardColumns(locale),
        body: sql<string>`COALESCE(${tr.body}, ${blogPosts.body})`,
        mentions: blogPosts.mentions,
        source: { title: blogPosts.title, summary: blogPosts.summary, body: blogPosts.body },
        contentHash: tr.contentHash,
        translatedAt: tr.translatedAt,
      })
      .from(blogPosts)
      .leftJoin(tr, joinTranslation(locale))
      .where(and(visible(now), eq(blogPosts.slug, slug)))
      .limit(1)
    if (!row) return null
    const { body, mentions, source, contentHash, translatedAt, ...card } = row
    return {
      ...toCard(card),
      body,
      mentions: json<BlogMention[]>(mentions),
      translation: contentHash ? { outdated: contentHash !== blogSourceHash(source), translatedAt: translatedAt?.toISOString() ?? null } : null,
    }
  }

  async neighbors(post: BlogCard, locale: Locale, now: Date) {
    const at = new Date(post.publishedAt)
    const [older, newer] = await Promise.all([
      this.cards(locale).where(and(visible(now), lt(blogPosts.publishedAt, at))).orderBy(desc(blogPosts.publishedAt)).limit(1),
      this.cards(locale).where(and(visible(now), gt(blogPosts.publishedAt, at))).orderBy(blogPosts.publishedAt).limit(1),
    ])
    return { older: older[0] ? toCard(older[0]) : null, newer: newer[0] ? toCard(newer[0]) : null }
  }

  async related(post: BlogCard, limit: number, locale: Locale, now: Date) {
    const rows = await this.cards(locale)
      .where(and(visible(now), ne(blogPosts.slug, post.slug)))
      // 有相同标签的排前面，其次按发布时间
      .orderBy(sql`JSON_OVERLAPS(${blogPosts.tags}, ${JSON.stringify(post.tags)}) DESC`, desc(blogPosts.publishedAt))
      .limit(limit)
    return rows.map(toCard)
  }
}
