import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SiteUserSync } from '../admin/site-users.ts'
import { dbTime } from '../admin/time.ts'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import { ApiError } from '../api/http/errors.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { adminSiteUsers, commentReactions, comments } from '../db/schema/index.ts'
import type { AdminUser } from './auth.ts'

/*
 * 后台的网站用户接口（挂在 /api/admin/users 下，登录后才能访问），只读，数据来自同步到 admin_site_users 的副本：
 *   GET  /summary                                                      概览：总数、新增、登录、发过评论、各登录方式人数、上次同步时间
 *   GET  /?q&provider&status&registered&signIn&sort&page&pageSize      用户列表，带评论数
 *   GET  /:id                                                          详情：账号信息、评论和表态次数、最近 10 条评论
 *   POST /sync                                                         立即从 Supabase 同步一次
 */

const PROVIDERS = ['github', 'google', 'email'] as const
const DAY = 86400_000

const listSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  provider: z.enum(PROVIDERS).optional(),
  /** active 正常 / unverified 邮箱未验证 / banned 已封禁 */
  status: z.enum(['active', 'unverified', 'banned']).optional(),
  /** 注册时间在最近几天内 */
  registered: z.enum(['1d', '7d', '30d']).optional(),
  /** 最近几天内登录过；stale 是 90 天以上没登录过 */
  signIn: z.enum(['7d', '30d', '90d', 'stale']).optional(),
  sort: z.enum(['new', 'recent', 'comments']).default('new'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY)
const DAYS = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 } as const

/** 北京时间今天 0 点 */
function beijingToday(now: Date): Date {
  const bj = new Date(now.getTime() + 8 * 3600_000)
  return new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3600_000)
}

/** 子查询里写全表名：单表查询时 drizzle 生成的列名不带表名，会被解析成子查询里的同名列 */
const commentCount = sql<number>`(SELECT COUNT(*) FROM comments c WHERE c.user_id = admin_site_users.id)`.mapWith(Number)

type Row = typeof adminSiteUsers.$inferSelect

function present(row: Row, now: Date) {
  const banned = !!row.bannedUntil && row.bannedUntil > now
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    providers: row.providers ? row.providers.split(',') : [],
    githubLogin: row.githubLogin,
    locale: row.locale,
    registeredAt: row.registeredAt,
    lastSignInAt: row.lastSignInAt,
    emailConfirmedAt: row.emailConfirmedAt,
    bannedUntil: banned ? row.bannedUntil : null,
    status: banned ? 'banned' : row.emailConfirmedAt ? 'active' : 'unverified',
  }
}

export function adminUserRoutes(deps: { db: Db; logger: Logger; siteUrl: string; sync?: SiteUserSync }) {
  const { db } = deps
  const app = new Hono<{ Variables: { user: AdminUser } }>()

  app.get('/summary', async (c) => {
    const now = new Date()
    const u = adminSiteUsers
    const has = (p: string) => sql`SUM(FIND_IN_SET(${p}, ${u.providers}) > 0)`.mapWith(Number)
    const [[users], [talk]] = await Promise.all([
      db
        .select({
          total: sql`COUNT(*)`.mapWith(Number),
          today: sql`SUM(${u.registeredAt} >= ${beijingToday(now)})`.mapWith(Number),
          new7d: sql`SUM(${u.registeredAt} >= ${daysAgo(now, 7)})`.mapWith(Number),
          prev7d: sql`SUM(${u.registeredAt} >= ${daysAgo(now, 14)} AND ${u.registeredAt} < ${daysAgo(now, 7)})`.mapWith(Number),
          signIn7d: sql`SUM(${u.lastSignInAt} >= ${daysAgo(now, 7)})`.mapWith(Number),
          github: has('github'),
          google: has('google'),
          email: has('email'),
          syncedAt: sql<string | null>`MAX(${u.syncedAt})`,
        })
        .from(u),
      db.select({ comments: sql`COUNT(*)`.mapWith(Number), commenters: sql`COUNT(DISTINCT ${comments.userId})`.mapWith(Number) }).from(comments),
    ])
    const { github, google, email, syncedAt, ...counts } = users!
    return c.json({
      data: {
        ...counts,
        providers: { github, google, email },
        comments: talk?.comments ?? 0,
        commenters: talk?.commenters ?? 0,
        syncedAt: syncedAt ? dbTime(syncedAt) : null,
        syncEnabled: !!deps.sync,
      },
    })
  })

  app.get('/', async (c) => {
    const q = parseQuery(c, listSchema)
    const now = new Date()
    const u = adminSiteUsers
    const conditions: SQL[] = []
    if (q.q) conditions.push(or(sql`${u.email} LIKE ${likeOf(q.q)}`, sql`${u.name} LIKE ${likeOf(q.q)}`, sql`${u.githubLogin} LIKE ${likeOf(q.q)}`, eq(u.id, q.q))!)
    if (q.provider) conditions.push(sql`FIND_IN_SET(${q.provider}, ${u.providers}) > 0`)
    const notBanned = or(isNull(u.bannedUntil), lte(u.bannedUntil, now))!
    if (q.status === 'banned') conditions.push(gt(u.bannedUntil, now))
    if (q.status === 'unverified') conditions.push(isNull(u.emailConfirmedAt), notBanned)
    if (q.status === 'active') conditions.push(isNotNull(u.emailConfirmedAt), notBanned)
    if (q.registered) conditions.push(gte(u.registeredAt, daysAgo(now, DAYS[q.registered])))
    if (q.signIn === 'stale') conditions.push(or(isNull(u.lastSignInAt), lt(u.lastSignInAt, daysAgo(now, 90)))!)
    else if (q.signIn) conditions.push(gte(u.lastSignInAt, daysAgo(now, DAYS[q.signIn])))
    const where = conditions.length ? and(...conditions) : undefined
    const order = q.sort === 'recent' ? [desc(u.lastSignInAt), desc(u.registeredAt)] : q.sort === 'comments' ? [desc(commentCount), desc(u.registeredAt)] : [desc(u.registeredAt)]
    const [rows, [count]] = await Promise.all([
      db
        .select({ user: u, comments: commentCount })
        .from(u)
        .where(where)
        .orderBy(...order)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: sql`COUNT(*)`.mapWith(Number) }).from(u).where(where),
    ])
    const total = count?.n ?? 0
    return c.json({
      data: rows.map((r) => ({ ...present(r.user, now), comments: r.comments })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
    })
  })

  app.post('/sync', async (c) => {
    if (!deps.sync) throw ApiError.badRequest('没有配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，不能同步')
    const result = await deps.sync.sync().catch((error: unknown) => {
      throw new ApiError(502, 'sync_failed', `同步失败：${(error as Error).message}`)
    })
    deps.logger.info({ username: c.get('user').username, ...result }, '后台手动同步网站用户')
    return c.json({ data: result })
  })

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const [row] = await db.select().from(adminSiteUsers).where(eq(adminSiteUsers.id, id))
    if (!row) throw ApiError.notFound('用户不存在')
    const [recent, [counts], [reactions]] = await Promise.all([
      db
        .select({
          id: comments.id,
          kind: comments.kind,
          slug: comments.slug,
          parentId: comments.parentId,
          body: sql<string>`LEFT(${comments.body}, 300)`,
          createdAt: comments.createdAt,
          name: sql<string | null>`(SELECT s.name FROM admin_item_status s WHERE s.kind = comments.kind AND s.slug = comments.slug AND s.active = 1 LIMIT 1)`,
        })
        .from(comments)
        .where(eq(comments.userId, id))
        .orderBy(desc(comments.createdAt))
        .limit(10),
      db.select({ n: sql`COUNT(*)`.mapWith(Number) }).from(comments).where(eq(comments.userId, id)),
      db.select({ n: sql`COUNT(*)`.mapWith(Number) }).from(commentReactions).where(eq(commentReactions.userId, id)),
    ])
    return c.json({
      data: {
        ...present(row, new Date()),
        comments: counts?.n ?? 0,
        reactions: reactions?.n ?? 0,
        recentComments: recent.map((r) => ({ ...r, url: `${deps.siteUrl}/${ROUTE_BY_KIND[r.kind]}/${r.slug}` })),
      },
    })
  })

  return app
}
