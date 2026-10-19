import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import { ApiError } from '../api/http/errors.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { feedback } from '../db/schema/index.ts'
import type { AdminUser } from './auth.ts'

/*
 * 后台的反馈接口（挂在 /api/admin/feedback 下，登录后才能访问）：
 *   GET  /?status&q&page&pageSize   反馈列表（status：open 待处理 / resolved 已处理 / ignored 忽略），附带各状态的条数
 *   POST /:id/status                { status } 改状态；改回 open 时清空处理人和处理时间
 */

const STATUSES = ['open', 'resolved', 'ignored'] as const

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/** 名称和图标取自后台条目状态表（发布条目的冗余） */
const item = (column: 'name' | 'icon_url') =>
  sql<string | null>`(SELECT s.${sql.raw(column)} FROM admin_item_status s WHERE s.kind = feedback.kind AND s.slug = feedback.slug AND s.active = 1 LIMIT 1)`

export function adminFeedbackRoutes(deps: { db: Db; logger: Logger; siteUrl: string }) {
  const { db } = deps
  const app = new Hono<{ Variables: { user: AdminUser } }>()

  app.get('/', async (c) => {
    const q = parseQuery(c, listSchema)
    const conditions: SQL[] = []
    if (q.status) conditions.push(eq(feedback.status, q.status))
    if (q.q) conditions.push(or(sql`${feedback.slug} LIKE ${likeOf(q.q)}`, sql`${feedback.body} LIKE ${likeOf(q.q)}`, sql`${feedback.email} LIKE ${likeOf(q.q)}`, sql`${feedback.userName} LIKE ${likeOf(q.q)}`)!)
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, [count], totals] = await Promise.all([
      db
        .select({
          id: feedback.id,
          kind: feedback.kind,
          slug: feedback.slug,
          name: item('name'),
          iconUrl: item('icon_url'),
          type: feedback.type,
          body: feedback.body,
          email: feedback.email,
          userName: feedback.userName,
          status: feedback.status,
          handledAt: feedback.handledAt,
          handledBy: feedback.handledBy,
          createdAt: feedback.createdAt,
        })
        .from(feedback)
        .where(where)
        .orderBy(desc(feedback.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`COUNT(*)` }).from(feedback).where(where),
      db.select({ status: feedback.status, n: sql<number>`COUNT(*)` }).from(feedback).groupBy(feedback.status),
    ])
    const total = Number(count?.n ?? 0)
    const counts = { all: 0, open: 0, resolved: 0, ignored: 0 }
    for (const t of totals) {
      counts.all += Number(t.n)
      if (t.status in counts) counts[t.status as keyof typeof counts] = Number(t.n)
    }
    return c.json({
      data: rows.map((r) => ({ ...r, url: `${deps.siteUrl}/${ROUTE_BY_KIND[r.kind]}/${encodeURIComponent(r.slug)}` })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      counts,
    })
  })

  app.post('/:id/status', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('反馈不存在')
    const input = z.object({ status: z.enum(STATUSES) }).safeParse(await c.req.json().catch(() => ({})))
    if (!input.success) throw ApiError.badRequest('状态不合法')
    const { status } = input.data
    const username = c.get('user').username
    const handled = status === 'open' ? { handledAt: null, handledBy: null } : { handledAt: new Date(), handledBy: username }
    const [result] = await db.update(feedback).set({ status, ...handled }).where(eq(feedback.id, id))
    if (!result.affectedRows) throw ApiError.notFound('反馈不存在')
    deps.logger.info({ username, id, status }, '反馈改状态')
    return c.json({ data: { ok: true } })
  })

  return app
}
