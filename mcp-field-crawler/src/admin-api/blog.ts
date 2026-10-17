import { createHash } from 'node:crypto'
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AssetStorage } from '../assets/storage.ts'
import { BLOG_CATEGORIES, BLOG_SLUG_RE, BLOG_STATUSES, extractMentionTargets, normalizeTags, readingMinutes, type BlogMention } from '../blog/post.ts'
import { ApiError } from '../api/http/errors.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import type { AdminUser } from './auth.ts'
import { adminItemStatus, blogPosts } from '../db/schema/index.ts'

/*
 * 后台的博客接口（挂在 /api/admin/blog 下，登录后才能访问）：
 *   GET    /posts?status&q&page&pageSize   全部文章（含草稿），附带各状态的篇数
 *   GET    /posts/:id                      一篇的全部字段
 *   POST   /posts                          新建
 *   PUT    /posts/:id                      保存
 *   DELETE /posts/:id                      删除
 *   POST   /uploads                        上传图片（multipart 的 file 字段），返回公开地址
 * 保存时算好阅读时长，并从正文链接解析“文中提到的”站内条目（名称、图标取自 admin_item_status）。
 */

/** 列表筛选：scheduled = 已发布但发布时间还没到 */
const LIST_STATUSES = ['draft', 'published', 'scheduled'] as const

const listSchema = z.object({
  status: z.enum(LIST_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const postSchema = z.object({
  slug: z.string().trim().toLowerCase().min(1, '请填写地址').max(120).regex(BLOG_SLUG_RE, '地址只能用小写字母、数字和连字符'),
  title: z.string().trim().min(1, '请填写标题').max(200),
  summary: z.string().trim().max(500).default(''),
  body: z.string().max(500_000),
  category: z.enum(BLOG_CATEGORIES),
  tags: z.array(z.string().max(40)).max(20).default([]),
  coverUrl: z
    .string()
    .trim()
    .max(1024)
    .regex(/^https:\/\//, '封面地址要以 https:// 开头')
    .nullable()
    .optional()
    .transform((v) => v || null),
  authorName: z.string().trim().min(1, '请填写作者').max(64),
  status: z.enum(BLOG_STATUSES),
  pinned: z.boolean().default(false),
  /** 不填时第一次发布取当前时间 */
  publishedAt: z.iso.datetime({ offset: true }).nullable().optional(),
})

type PostInput = z.infer<typeof postSchema>

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }
const UPLOAD_MAX = 8 * 1024 * 1024

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

const idOf = (raw: string): number => {
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('文章不存在')
  return id
}

const listColumns = {
  id: blogPosts.id,
  slug: blogPosts.slug,
  title: blogPosts.title,
  category: blogPosts.category,
  status: blogPosts.status,
  pinned: blogPosts.pinned,
  views: blogPosts.views,
  authorName: blogPosts.authorName,
  publishedAt: blogPosts.publishedAt,
  updatedAt: blogPosts.updatedAt,
}

/** 正文里链接到的站内条目：按出现顺序，取后台条目表里的名称、图标、热度；找不到的（地址写错或已下线）跳过 */
export async function resolveMentions(db: Db, body: string): Promise<BlogMention[]> {
  const targets = extractMentionTargets(body)
  if (!targets.length) return []
  const rows = await db
    .select({ kind: adminItemStatus.kind, slug: adminItemStatus.slug, name: adminItemStatus.name, iconUrl: adminItemStatus.iconUrl, popularity: adminItemStatus.popularity })
    .from(adminItemStatus)
    .where(and(eq(adminItemStatus.active, true), or(...targets.map((t) => and(eq(adminItemStatus.kind, t.kind), eq(adminItemStatus.slug, t.slug))))))
  const byKey = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, r]))
  return targets.flatMap((t) => {
    const r = byKey.get(`${t.kind}/${t.slug}`)
    return r ? [{ kind: r.kind, slug: r.slug, name: r.name, iconUrl: r.iconUrl, popularity: r.popularity }] : []
  })
}

async function values(db: Db, input: PostInput, previous: { publishedAt: Date | null } | null) {
  const publishedAt = input.publishedAt ? new Date(input.publishedAt) : input.status === 'published' ? (previous?.publishedAt ?? new Date()) : (previous?.publishedAt ?? null)
  return {
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    body: input.body,
    category: input.category,
    tags: normalizeTags(input.tags),
    coverUrl: input.coverUrl,
    authorName: input.authorName,
    status: input.status,
    pinned: input.pinned,
    mentions: await resolveMentions(db, input.body),
    readingMinutes: readingMinutes(input.body),
    publishedAt,
    updatedAt: new Date(),
  }
}

const isDuplicate = (e: unknown) => (e as { code?: string; cause?: { code?: string } }).code === 'ER_DUP_ENTRY' || (e as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY'

export function adminBlogRoutes(deps: { db: Db; storage?: AssetStorage; logger: Logger; siteUrl: string }) {
  const { db } = deps
  // 登录校验在外层（app.ts）完成，这里直接取当前账号
  const app = new Hono<{ Variables: { user: AdminUser } }>()

  async function detail(id: number) {
    const [row] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1)
    if (!row) throw ApiError.notFound('文章不存在')
    return { ...row, tags: json<string[]>(row.tags), mentions: json<BlogMention[]>(row.mentions), pinned: Boolean(row.pinned), url: `${deps.siteUrl}/blog/${row.slug}` }
  }

  async function body(c: { req: { json(): Promise<unknown> } }) {
    const result = postSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!result.success) throw ApiError.badRequest(result.error.issues[0]?.message ?? '请求内容不合法', result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
    return result.data
  }

  const conflict = () => new ApiError(409, 'conflict', '这个地址已经被别的文章用了，换一个')

  app.get('/posts', async (c) => {
    const q = parseQuery(c, listSchema)
    const now = new Date()
    const conditions: SQL[] = []
    if (q.status === 'draft') conditions.push(eq(blogPosts.status, 'draft'))
    if (q.status === 'published') conditions.push(sql`${blogPosts.status} = 'published' AND ${blogPosts.publishedAt} <= ${now}`)
    if (q.status === 'scheduled') conditions.push(sql`${blogPosts.status} = 'published' AND ${blogPosts.publishedAt} > ${now}`)
    if (q.q) conditions.push(or(sql`${blogPosts.title} LIKE ${likeOf(q.q)}`, sql`${blogPosts.slug} LIKE ${likeOf(q.q)}`)!)
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, [count], counts] = await Promise.all([
      db
        .select(listColumns)
        .from(blogPosts)
        .where(where)
        // 草稿（没有发布时间）按修改时间排在最前
        .orderBy(sql`${blogPosts.publishedAt} IS NULL DESC`, desc(blogPosts.publishedAt), desc(blogPosts.updatedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`COUNT(*)` }).from(blogPosts).where(where),
      db
        .select({
          all: sql<number>`COUNT(*)`,
          draft: sql<number>`SUM(${blogPosts.status} = 'draft')`,
          published: sql<number>`SUM(${blogPosts.status} = 'published' AND ${blogPosts.publishedAt} <= ${now})`,
          scheduled: sql<number>`SUM(${blogPosts.status} = 'published' AND ${blogPosts.publishedAt} > ${now})`,
        })
        .from(blogPosts),
    ])
    const total = Number(count?.n ?? 0)
    const n = counts[0]
    return c.json({
      data: rows.map((r) => ({ ...r, pinned: Boolean(r.pinned), url: `${deps.siteUrl}/blog/${r.slug}`, scheduled: r.status === 'published' && !!r.publishedAt && r.publishedAt > now })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      counts: { all: Number(n?.all ?? 0), draft: Number(n?.draft ?? 0), published: Number(n?.published ?? 0), scheduled: Number(n?.scheduled ?? 0) },
    })
  })

  app.get('/posts/:id', async (c) => c.json({ data: await detail(idOf(c.req.param('id'))) }))

  app.post('/posts', bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    const input = await body(c)
    try {
      const [result] = await db.insert(blogPosts).values(await values(db, input, null))
      const id = (result as { insertId: number }).insertId
      deps.logger.info({ username: c.get('user').username, id, slug: input.slug, status: input.status }, '新建博客文章')
      return c.json({ data: await detail(id) })
    } catch (e) {
      throw isDuplicate(e) ? conflict() : e
    }
  })

  app.put('/posts/:id', bodyLimit({ maxSize: 2 * 1024 * 1024 }), async (c) => {
    const id = idOf(c.req.param('id'))
    const input = await body(c)
    const [previous] = await db.select({ publishedAt: blogPosts.publishedAt }).from(blogPosts).where(eq(blogPosts.id, id)).limit(1)
    if (!previous) throw ApiError.notFound('文章不存在')
    try {
      await db.update(blogPosts).set(await values(db, input, previous)).where(eq(blogPosts.id, id))
    } catch (e) {
      throw isDuplicate(e) ? conflict() : e
    }
    deps.logger.info({ username: c.get('user').username, id, slug: input.slug, status: input.status }, '保存博客文章')
    return c.json({ data: await detail(id) })
  })

  app.delete('/posts/:id', async (c) => {
    const id = idOf(c.req.param('id'))
    const [result] = await db.delete(blogPosts).where(eq(blogPosts.id, id))
    if ((result as { affectedRows?: number }).affectedRows !== 1) throw ApiError.notFound('文章不存在')
    deps.logger.info({ username: c.get('user').username, id }, '删除博客文章')
    return c.json({ data: { ok: true } })
  })

  app.post('/uploads', bodyLimit({ maxSize: UPLOAD_MAX + 64 * 1024, onError: (c) => c.json({ error: { code: 'bad_request', message: '图片不能超过 8 MB' } }, 413) }), async (c) => {
    if (!deps.storage) throw new ApiError(503, 'storage_unavailable', '服务器没有配置对象存储（R2），不能上传图片')
    const form = await c.req.parseBody()
    const file = form.file
    if (!(file instanceof File)) throw ApiError.badRequest('请选择图片')
    const ext = IMAGE_TYPES[file.type]
    if (!ext) throw ApiError.badRequest('只支持 PNG、JPEG、WebP、GIF、AVIF 图片')
    if (file.size > UPLOAD_MAX) throw ApiError.badRequest('图片不能超过 8 MB')
    const buffer = Buffer.from(await file.arrayBuffer())
    // 按内容命名：同一张图重复上传得到同一个地址
    const key = `blog/${createHash('sha256').update(buffer).digest('hex').slice(0, 24)}.${ext}`
    if (!(await deps.storage.exists(key))) await deps.storage.put(key, buffer, file.type)
    deps.logger.info({ username: c.get('user').username, key, bytes: buffer.length }, '上传博客图片')
    return c.json({ data: { url: deps.storage.publicUrl(key) } })
  })

  return app
}
