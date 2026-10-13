import { sql, type SQL } from 'drizzle-orm'
import { ENTITY_KINDS, type EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'

/** 首页统计：各类型总数、近几天每天新增多少、最近一次发布时间 */
export interface SiteStats {
  totals: Record<EntityKind, number>
  /** 远程 MCP 服务的数量 */
  remote: number
  /**
   * 近 DAYS 天每天新增的条目数，截止到有数据的最后一天（当天的数据要等每日任务跑完才有）。
   * 按源站的上架日期（sourceCreatedAt）统计：我们的首次发现时间集中在全量导入那几天，反映不了每天的新增。
   * Skill、CLI 没有上架日期，不计入。
   */
  daily: { date: string; count: number }[]
  /** 发布层最近一次重建的时间（网站数据的更新时间） */
  publishedAt: string | null
}

export interface StatsReader {
  read(days: number): Promise<SiteStats>
}

const DAYS = 14
/** 统计要扫描整张发布表，结果缓存一段时间；发布层每天只重建一次 */
const TTL_MS = 10 * 60_000

/** mysql2 对原生查询可能返回 Date 或 'YYYY-MM-DD HH:MM:SS'（UTC）字符串 */
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value).replace(' ', 'T') + 'Z').toISOString()
}

/** 从发布层 ingest_published 读取统计 */
export class PublishedStatsReader implements StatsReader {
  constructor(private readonly db: Db) {}

  private async rows<T>(query: SQL): Promise<T[]> {
    const [rows] = (await this.db.execute(query)) as unknown as [T[]]
    return rows
  }

  async read(days: number): Promise<SiteStats> {
    const created = sql`LEFT(JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.sourceCreatedAt')), 10)`
    const [kinds, remote, daily, latest] = await Promise.all([
      this.rows<{ kind: EntityKind; total: number | string }>(sql`SELECT d.kind, COUNT(*) AS total FROM ingest_published d GROUP BY d.kind`),
      this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total FROM ingest_published d WHERE d.kind = 'server' AND JSON_EXTRACT(d.draft, '$.detail.isRemote') = TRUE`),
      // 先取最近有数据的那天，再往前数 days 天
      this.rows<{ day: string; total: number | string }>(sql`
        SELECT ${created} AS day, COUNT(*) AS total
        FROM ingest_published d
        WHERE ${created} >= DATE_FORMAT(UTC_DATE() - INTERVAL ${days + 1} DAY, '%Y-%m-%d') AND ${created} <= DATE_FORMAT(UTC_DATE(), '%Y-%m-%d')
        GROUP BY day`),
      this.rows<{ at: unknown }>(sql`SELECT MAX(d.published_at) AS at FROM ingest_published d`),
    ])
    const totals = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>
    for (const r of kinds) totals[r.kind] = Number(r.total)
    return { totals, remote: Number(remote[0]?.total ?? 0), daily: fillDays(daily.map((r) => ({ date: r.day, count: Number(r.total) })), days), publishedAt: toIso(latest[0]?.at) }
  }
}

/** 补齐没有条目的日子，取截止到最后一个有数据日期的连续 days 天 */
export function fillDays(rows: { date: string; count: number }[], days: number): { date: string; count: number }[] {
  if (rows.length === 0) return []
  const byDate = new Map(rows.map((r) => [r.date, r.count]))
  const last = rows.map((r) => r.date).sort().at(-1)!
  const end = Date.parse(`${last}T00:00:00Z`)
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { date, count: byDate.get(date) ?? 0 }
  })
}

/** 带缓存的统计服务 */
export class StatsService {
  private cache: { at: number; value: Promise<SiteStats> } | null = null

  constructor(
    private readonly reader: StatsReader,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<SiteStats> {
    const t = this.now()
    if (!this.cache || t - this.cache.at > TTL_MS) {
      const value = this.reader.read(DAYS)
      this.cache = { at: t, value }
      // 失败的结果不缓存，下次请求重试
      value.catch(() => {
        if (this.cache?.value === value) this.cache = null
      })
    }
    return this.cache.value
  }
}
