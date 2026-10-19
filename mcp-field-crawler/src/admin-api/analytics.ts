import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { beijingDay } from '../analytics/classify.ts'
import { DIMS } from '../analytics/rollup.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Db } from '../db/client.ts'
import type { AdminUser } from './auth.ts'

/*
 * 后台的访问统计接口（挂在 /api/admin/analytics 下，登录后才能访问）：
 *   GET /overview                  近 30 天每天的浏览量、访客数、访问次数（今天和还没汇总的日子从明细现算）
 *   GET /breakdown?dim&range       某个维度的排行（range：today / yesterday / 7d / 30d），前 50
 *   GET /crawlers?days             近几天各爬虫每天的请求数和出错数（来自 nginx 日志，到昨天为止）
 * 多天的访客数是每天访客数相加：访客标识每天换盐，跨天认不出同一个人。
 */

const RANGES = { today: [0, 0], yesterday: [1, 1], '7d': [6, 0], '30d': [29, 0] } as const

const breakdownSchema = z.object({
  dim: z.enum(Object.keys(DIMS) as [keyof typeof DIMS, ...(keyof typeof DIMS)[]]),
  range: z.enum(Object.keys(RANGES) as [keyof typeof RANGES, ...(keyof typeof RANGES)[]]).default('7d'),
})
const crawlerSchema = z.object({ days: z.coerce.number().int().min(1).max(60).default(14) })

const daysAgo = (n: number, now = new Date()) => beijingDay(new Date(now.getTime() - n * 86_400_000))

type Counts = { pv: number; uv: number; visits: number }
const counts = (r: { pv: unknown; uv: unknown; visits: unknown }): Counts => ({ pv: Number(r.pv), uv: Number(r.uv), visits: Number(r.visits ?? 0) })

/** 已经汇总过的日子不再查明细 */
const notRolled = (from: string, to: string) => sql`day NOT IN (SELECT d.day FROM analytics_daily d WHERE d.dim = 'total' AND d.day BETWEEN ${from} AND ${to})`

export async function analyticsOverview(db: Db, now = new Date()) {
  const from = daysAgo(29, now)
  const to = beijingDay(now)
  const rows = <T>(q: ReturnType<typeof sql>) => db.execute(q).then(([r]) => r as unknown as T[])
  const [rolled, live] = await Promise.all([
    rows<{ day: string } & Counts>(sql`SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, pv, uv, visits FROM analytics_daily WHERE dim = 'total' AND day BETWEEN ${from} AND ${to}`),
    rows<{ day: string } & Counts>(sql`
      SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv, SUM(entry) AS visits
      FROM analytics_events WHERE day BETWEEN ${from} AND ${to} AND ${notRolled(from, to)} GROUP BY day`),
  ])
  const byDay = new Map([...rolled, ...live].map((r) => [r.day, counts(r)]))
  const trend = Array.from({ length: 30 }, (_, i) => daysAgo(29 - i, now)).map((day) => ({ day, ...(byDay.get(day) ?? { pv: 0, uv: 0, visits: 0 }) }))
  return { today: to, trend }
}

export async function analyticsBreakdown(db: Db, dim: keyof typeof DIMS, range: keyof typeof RANGES, now = new Date()) {
  const [a, b] = RANGES[range]
  const from = daysAgo(a, now)
  const to = daysAgo(b, now)
  const column = sql.raw(DIMS[dim])
  const [rows] = await db.execute(sql`
    SELECT value, SUM(pv) AS pv, SUM(uv) AS uv, SUM(visits) AS visits FROM (
      SELECT value, pv, uv, visits FROM analytics_daily WHERE dim = ${dim} AND day BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT ${column} AS value, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv, SUM(entry) AS visits
      FROM analytics_events WHERE day BETWEEN ${from} AND ${to} AND ${notRolled(from, to)} ${dim === 'source' ? sql`AND entry = 1` : sql``}
      GROUP BY day, ${column}
    ) t
    GROUP BY value ORDER BY pv DESC, value LIMIT 50`)
  return { from, to, rows: (rows as unknown as ({ value: string } & Counts)[]).map((r) => ({ value: r.value, ...counts(r) })) }
}

export async function crawlerStats(db: Db, days: number, now = new Date()) {
  const from = daysAgo(days, now)
  const to = daysAgo(1, now)
  const [rows] = await db.execute(sql`
    SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, bot, SUM(hits) AS hits, SUM(IF(status >= 400 AND status < 500, hits, 0)) AS e4xx, SUM(IF(status >= 500, hits, 0)) AS e5xx
    FROM crawler_daily WHERE day BETWEEN ${from} AND ${to} GROUP BY day, bot`)
  const list = (rows as unknown as { day: string; bot: string; hits: unknown; e4xx: unknown; e5xx: unknown }[]).map((r) => ({ day: r.day, bot: r.bot, hits: Number(r.hits), e4xx: Number(r.e4xx), e5xx: Number(r.e5xx) }))
  const dayList = [...new Set(list.map((r) => r.day))].sort()
  const bots = new Map<string, { bot: string; total: number; e4xx: number; e5xx: number; byDay: Record<string, number> }>()
  for (const r of list) {
    if (r.bot === '_all') continue
    const b = bots.get(r.bot) ?? { bot: r.bot, total: 0, e4xx: 0, e5xx: 0, byDay: {} }
    b.total += r.hits
    b.e4xx += r.e4xx
    b.e5xx += r.e5xx
    b.byDay[r.day] = r.hits
    bots.set(r.bot, b)
  }
  return {
    days: dayList,
    /** 每天日志总行数（含普通访问和静态资源） */
    totals: Object.fromEntries(list.filter((r) => r.bot === '_all').map((r) => [r.day, r.hits])),
    bots: [...bots.values()].sort((x, y) => y.total - x.total),
  }
}

export function adminAnalyticsRoutes(deps: { db: Db }) {
  const { db } = deps
  return new Hono<{ Variables: { user: AdminUser } }>()
    .get('/overview', async (c) => c.json({ data: await analyticsOverview(db) }))
    .get('/breakdown', async (c) => {
      const q = parseQuery(c, breakdownSchema)
      return c.json({ data: await analyticsBreakdown(db, q.dim, q.range) })
    })
    .get('/crawlers', async (c) => c.json({ data: await crawlerStats(db, parseQuery(c, crawlerSchema).days) }))
}
