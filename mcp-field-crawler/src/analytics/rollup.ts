import { existsSync } from 'node:fs'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { analyticsDaily, analyticsEvents, analyticsSalts, crawlerDaily } from '../db/schema/index.ts'
import { beijingDay } from './classify.ts'
import { countCrawlers, logFiles } from './crawlers.ts'

/*
 * 访问统计的定时任务（跑在后台接口进程里，每 30 分钟一次）：
 * 1. 把已经结束的日子（北京时间，过零点 10 分钟后，等最后一批浏览写进库）的明细汇总进 analytics_daily；
 * 2. 删除 90 天前的明细、昨天以前的盐（之后无法再从访客标识反查 IP）；
 * 3. 每天第一次运行时解析 nginx 访问日志，补上还没记过的日子的爬虫抓取量（crawler_daily）。
 */

/** analytics_daily 的维度和明细表里对应的列；source 只算一次访问的第一个页面 */
export const DIMS = { page: 'page', path: 'path', source: 'source', country: 'country', device: 'device', browser: 'browser', os: 'os', locale: 'locale' } as const
export type Dim = keyof typeof DIMS
/** 每天只留浏览量前这么多的路径 */
const TOP_PATHS = 200

export class AnalyticsRollup {
  private timer: ReturnType<typeof setInterval> | undefined
  private running: Promise<void> | null = null
  /** 爬虫日志当天已经解析过（每个进程每天最多一次） */
  private crawlersDoneFor = ''

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly options: { accessLog?: string; retentionDays?: number; now?: () => Date } = {},
  ) {}

  start(intervalMs = 30 * 60_000): void {
    this.timer = setInterval(() => this.kick(), intervalMs)
    this.timer.unref?.()
    this.kick()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  kick(): void {
    this.run().catch((error: unknown) => this.logger.warn({ err: (error as Error).message }, '访问统计汇总失败，下次再试'))
  }

  run(): Promise<void> {
    this.running ??= this.once().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async once(): Promise<void> {
    const now = this.options.now?.() ?? new Date()
    const today = beijingDay(now)
    const settled = beijingDay(new Date(now.getTime() - 10 * 60_000))
    const days = await this.unrolledDays(settled)
    for (const day of days) await this.rollupDay(day)
    if (days.length) this.logger.info({ days }, '访问统计已汇总')

    const keep = beijingDay(new Date(now.getTime() - (this.options.retentionDays ?? 90) * 86_400_000))
    await this.db.delete(analyticsEvents).where(lt(analyticsEvents.day, keep))
    await this.db.delete(analyticsSalts).where(lt(analyticsSalts.day, beijingDay(new Date(now.getTime() - 86_400_000))))

    if (this.crawlersDoneFor !== today) {
      await this.crawlers(today)
      this.crawlersDoneFor = today
    }
  }

  /** 明细里有、汇总表里还没有的日子（早于 before） */
  async unrolledDays(before: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ day: analyticsEvents.day })
      .from(analyticsEvents)
      .where(and(lt(analyticsEvents.day, before), sql`${analyticsEvents.day} NOT IN (SELECT d.day FROM analytics_daily d WHERE d.dim = 'total')`))
    return rows.map((r) => r.day).sort()
  }

  /** 汇总一天：先删后写，在一个事务里 */
  async rollupDay(day: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(analyticsDaily).where(eq(analyticsDaily.day, day))
      const insert = (dim: string, value: string, where = sql``, limit = sql``) =>
        tx.execute(sql`
          INSERT INTO analytics_daily (day, dim, value, pv, uv, visits)
          SELECT ${day}, ${dim}, ${sql.raw(value)}, COUNT(*), COUNT(DISTINCT visitor), SUM(entry)
          FROM analytics_events WHERE day = ${day} ${where}
          GROUP BY ${sql.raw(value)} ORDER BY COUNT(*) DESC ${limit}`)
      await insert('total', "''")
      for (const [dim, column] of Object.entries(DIMS)) {
        await insert(dim, column, dim === 'source' ? sql`AND entry = 1` : sql``, dim === 'path' ? sql`LIMIT ${TOP_PATHS}` : sql``)
      }
    })
  }

  /** 解析访问日志，补上还没记过的完整日子（不含今天和日志里最早那一天） */
  private async crawlers(today: string): Promise<void> {
    const accessLog = this.options.accessLog
    if (!accessLog || !existsSync(accessLog)) return
    const started = Date.now()
    const files = await logFiles(accessLog)
    const counts = await countCrawlers(files)
    const candidates = [...counts.totals.keys()].filter((d) => d < today && d !== counts.firstDay)
    if (!candidates.length) return
    const done = new Set(
      (await this.db.select({ day: crawlerDaily.day }).from(crawlerDaily).where(and(inArray(crawlerDaily.day, candidates), eq(crawlerDaily.bot, '_all')))).map((r) => r.day),
    )
    const missing = candidates.filter((d) => !done.has(d)).sort()
    for (const day of missing) {
      const rows = [...(counts.hits.get(day) ?? new Map<string, number>())].map(([key, hits]) => {
        const [bot, status] = key.split('|')
        return { day, bot: bot!, status: Number(status), hits }
      })
      // bot = _all 那一行：当天日志总行数，也是"这天已解析"的标记
      rows.push({ day, bot: '_all', status: 0, hits: counts.totals.get(day) ?? 0 })
      await this.db.transaction(async (tx) => {
        await tx.delete(crawlerDaily).where(eq(crawlerDaily.day, day))
        await tx.insert(crawlerDaily).values(rows)
      })
    }
    this.logger.info({ days: missing, files: files.length, seconds: Math.round((Date.now() - started) / 1000) }, '爬虫抓取量已统计')
  }
}
