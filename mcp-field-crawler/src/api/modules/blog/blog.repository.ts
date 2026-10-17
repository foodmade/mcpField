import { and, desc, eq, gt, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { BlogCategory, BlogMention } from '../../../blog/post.ts'
import type { Db } from '../../../db/client.ts'
import { blogPosts } from '../../../db/schema/index.ts'

/** 列表里的一篇文章（不带正文） */
export interface BlogCard {
  slug: string
  title: string
  summary: string
  category: BlogCategory
  tags: string[]
  coverUrl: string | null
  authorName: string
  pinned: boolean
  views: number
  readingMinutes: number
  publishedAt: string
  updatedAt: string
}

export interface BlogPostFull extends BlogCard {
  /** Markdown 原文 */
  body: string
  mentions: BlogMention[]
}

export interface BlogListQuery {
  category?: BlogCategory
  tag?: string
  q?: string
  page: number
  pageSize: number
}

export interface BlogRepository {
  list(query: BlogListQuery, now: Date): Promise<{ rows: BlogCard[]; total: number }>
  /** 全部已发布文章的栏目、标签、浏览数，汇总侧栏用（文章不多，直接取全部） */
  all(now: Date): Promise<BlogCard[]>
  find(slug: string, now: Date): Promise<BlogPostFull | null>
  /** 发布时间上相邻的两篇：older 更早的一篇，newer 更新的一篇 */
  neighbors(post: BlogCard, now: Date): Promise<{ older: BlogCard | null; newer: BlogCard | null }>
  related(post: BlogCard, limit: number, now: Date): Promise<BlogCard[]>
  addView(slug: string, now: Date): Promise<boolean>
}

const cardColumns = {
  slug: blogPosts.slug,
  title: blogPosts.title,
  summary: blogPosts.summary,
  category: blogPosts.category,
  tags: blogPosts.tags,
  coverUrl: blogPosts.coverUrl,
  authorName: blogPosts.authorName,
  pinned: blogPosts.pinned,
  views: blogPosts.views,
  readingMinutes: blogPosts.readingMinutes,
  publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt,
}

type CardRow = Omit<BlogCard, 'publishedAt' | 'updatedAt'> & { publishedAt: Date | null; updatedAt: Date }

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

const toCard = (r: CardRow): BlogCard => ({ ...r, tags: json<string[]>(r.tags), pinned: Boolean(r.pinned), publishedAt: r.publishedAt!.toISOString(), updatedAt: r.updatedAt.toISOString() })

/** 网站上看得到的：已发布且发布时间已到 */
const visible = (now: Date) => and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, now))!

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

export class MysqlBlogRepository implements BlogRepository {
  constructor(private readonly db: Db) {}

  async list(query: BlogListQuery, now: Date) {
    const conditions: SQL[] = [visible(now)]
    if (query.category) conditions.push(eq(blogPosts.category, query.category))
    if (query.tag) conditions.push(sql`JSON_CONTAINS(${blogPosts.tags}, JSON_QUOTE(${query.tag}))`)
    if (query.q) conditions.push(or(sql`${blogPosts.title} LIKE ${likeOf(query.q)}`, sql`${blogPosts.summary} LIKE ${likeOf(query.q)}`)!)
    const where = and(...conditions)
    const [rows, [count]] = await Promise.all([
      this.db
        .select(cardColumns)
        .from(blogPosts)
        .where(where)
        .orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: sql<number>`COUNT(*)` }).from(blogPosts).where(where),
    ])
    return { rows: rows.map(toCard), total: Number(count?.n ?? 0) }
  }

  async all(now: Date) {
    const rows = await this.db.select(cardColumns).from(blogPosts).where(visible(now)).orderBy(desc(blogPosts.publishedAt), desc(blogPosts.id))
    return rows.map(toCard)
  }

  async find(slug: string, now: Date) {
    const [row] = await this.db
      .select({ ...cardColumns, body: blogPosts.body, mentions: blogPosts.mentions })
      .from(blogPosts)
      .where(and(visible(now), eq(blogPosts.slug, slug)))
      .limit(1)
    if (!row) return null
    const { body, mentions, ...card } = row
    return { ...toCard(card), body, mentions: json<BlogMention[]>(mentions) }
  }

  async neighbors(post: BlogCard, now: Date) {
    const at = new Date(post.publishedAt)
    const [older, newer] = await Promise.all([
      this.db.select(cardColumns).from(blogPosts).where(and(visible(now), lt(blogPosts.publishedAt, at))).orderBy(desc(blogPosts.publishedAt)).limit(1),
      this.db.select(cardColumns).from(blogPosts).where(and(visible(now), gt(blogPosts.publishedAt, at))).orderBy(blogPosts.publishedAt).limit(1),
    ])
    return { older: older[0] ? toCard(older[0]) : null, newer: newer[0] ? toCard(newer[0]) : null }
  }

  async related(post: BlogCard, limit: number, now: Date) {
    const rows = await this.db
      .select(cardColumns)
      .from(blogPosts)
      .where(and(visible(now), ne(blogPosts.slug, post.slug)))
      // 同栏目的排前面，其次按发布时间
      .orderBy(sql`${blogPosts.category} = ${post.category} DESC`, desc(blogPosts.publishedAt))
      .limit(limit)
    return rows.map(toCard)
  }

  async addView(slug: string, now: Date) {
    const [result] = await this.db
      .update(blogPosts)
      .set({ views: sql`${blogPosts.views} + 1` })
      .where(and(visible(now), eq(blogPosts.slug, slug)))
    return (result as { affectedRows?: number }).affectedRows === 1
  }
}
