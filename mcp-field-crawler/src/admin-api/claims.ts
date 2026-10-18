import { and, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError } from '../api/http/errors.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { entityClaims } from '../db/schema/index.ts'
import type { AdminUser } from './auth.ts'

/*
 * 后台的认领接口（挂在 /api/admin/claims 下，登录后才能访问）：
 *   GET  /?status&q&page&pageSize   认领记录（status：active 有效 / revoked 已撤销），附带各状态的条数
 *   POST /:id/revoke                撤销：条目不再显示"已认证"，同一个 GitHub 账号不能再认领；其他人通过验证后可以重新认领
 * 撤销后网站列表最多 10 分钟后更新（网站接口的列表缓存），详情页立即生效。
 */

const listSchema = z.object({
  status: z.enum(['active', 'revoked']).optional(),
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
  sql<string | null>`(SELECT s.${sql.raw(column)} FROM admin_item_status s WHERE s.kind = entity_claims.kind AND s.slug = entity_claims.slug AND s.active = 1 LIMIT 1)`

export function adminClaimRoutes(deps: { db: Db; logger: Logger; siteUrl: string }) {
  const { db } = deps
  const app = new Hono<{ Variables: { user: AdminUser } }>()

  app.get('/', async (c) => {
    const q = parseQuery(c, listSchema)
    const conditions: SQL[] = []
    if (q.status === 'active') conditions.push(isNull(entityClaims.revokedAt))
    if (q.status === 'revoked') conditions.push(isNotNull(entityClaims.revokedAt))
    if (q.q) conditions.push(or(sql`${entityClaims.slug} LIKE ${likeOf(q.q)}`, sql`${entityClaims.githubLogin} LIKE ${likeOf(q.q)}`, sql`${entityClaims.repoFullName} LIKE ${likeOf(q.q)}`)!)
    const where = conditions.length ? and(...conditions) : undefined
    const [rows, [count], [n]] = await Promise.all([
      db
        .select({
          id: entityClaims.id,
          kind: entityClaims.kind,
          slug: entityClaims.slug,
          name: item('name'),
          iconUrl: item('icon_url'),
          userName: entityClaims.userName,
          githubLogin: entityClaims.githubLogin,
          githubAvatar: entityClaims.githubAvatar,
          repoFullName: entityClaims.repoFullName,
          method: entityClaims.method,
          claimedAt: entityClaims.claimedAt,
          revokedAt: entityClaims.revokedAt,
          revokedBy: entityClaims.revokedBy,
        })
        .from(entityClaims)
        .where(where)
        .orderBy(desc(entityClaims.claimedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`COUNT(*)` }).from(entityClaims).where(where),
      db.select({ all: sql<number>`COUNT(*)`, active: sql<number>`SUM(${entityClaims.revokedAt} IS NULL)` }).from(entityClaims),
    ])
    const total = Number(count?.n ?? 0)
    const all = Number(n?.all ?? 0)
    const active = Number(n?.active ?? 0)
    return c.json({
      data: rows.map((r) => ({ ...r, url: `${deps.siteUrl}/servers/${encodeURIComponent(r.slug)}` })),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      counts: { all, active, revoked: all - active },
    })
  })

  app.post('/:id/revoke', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('认领记录不存在')
    const username = c.get('user').username
    const [result] = await db
      .update(entityClaims)
      .set({ revokedAt: new Date(), revokedBy: username })
      .where(and(eq(entityClaims.id, id), isNull(entityClaims.revokedAt)))
    if (!result.affectedRows) throw ApiError.notFound('认领记录不存在或已撤销')
    deps.logger.info({ username, id }, '撤销认领')
    return c.json({ data: { ok: true } })
  })

  return app
}
