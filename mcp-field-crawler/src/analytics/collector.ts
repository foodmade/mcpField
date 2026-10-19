import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { analyticsEvents, analyticsSalts } from '../db/schema/index.ts'
import { beijingDay, classifyPath, isBot, parseUa, sourceOf } from './classify.ts'

/*
 * 页面浏览的采集：POST /api/collect 收到一条就放进内存，每 5 秒（或攒够 200 条）批量写一次库，接口立即返回。
 * 访客标识 = SHA-256(当天的盐 + IP + User-Agent) 的前 32 位：盐存在 analytics_salts，同一天各进程、重启前后都用同一个；
 * 两天后由后台的汇总任务删除，之后无法再从标识反查 IP。IP 本身不落库。
 */

export interface PageView {
  path: string
  /** 来源页面（只有一次访问的第一个页面带） */
  referrer?: string
  entry: boolean
  ip: string | null
  ua: string
  /** Cloudflare 的 CF-IPCountry */
  country?: string | null
  at?: Date
}

type Row = typeof analyticsEvents.$inferInsert

export class AnalyticsCollector {
  private queue: Row[] = []
  private readonly salts = new Map<string, Promise<string>>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly db: Db,
    private readonly siteHost: string,
    private readonly logger: Logger,
    private readonly options = { flushMs: 5000, maxBatch: 200, maxQueue: 5000 },
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.options.flushMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.flush()
  }

  /** 记一次浏览；爬虫、无效地址返回 false。只做内存操作，不等数据库 */
  async record(v: PageView): Promise<boolean> {
    const at = v.at ?? new Date()
    const page = classifyPath(v.path)
    if (!page || isBot(v.ua)) return false
    // 数据库写不进去时内存里最多攒这么多，之后丢弃，免得把进程内存撑爆
    if (this.queue.length >= this.options.maxQueue) return false
    const day = beijingDay(at)
    const salt = await this.saltOf(day)
    const visitor = createHash('sha256').update(`${salt}|${v.ip ?? ''}|${v.ua}`).digest('hex').slice(0, 32)
    const country = /^[A-Z]{2}$/.test(v.country ?? '') && v.country !== 'T1' ? v.country! : 'XX'
    this.queue.push({ day, at, visitor, entry: v.entry, ...page, source: v.entry ? sourceOf(v.referrer, this.siteHost) : '', country, ...parseUa(v.ua) })
    if (this.queue.length >= this.options.maxBatch) void this.flush()
    return true
  }

  /** 把内存里的浏览写进库；失败时放回队列下次再写 */
  async flush(): Promise<void> {
    if (!this.queue.length) return
    const rows = this.queue
    this.queue = []
    try {
      await this.db.insert(analyticsEvents).values(rows)
    } catch (error) {
      this.queue = [...rows, ...this.queue].slice(0, this.options.maxQueue)
      this.logger.warn({ err: (error as Error).message, rows: rows.length }, '访问统计写入失败，稍后重试')
    }
  }

  /** 当天的盐：库里没有就生成一个（并发、多进程时以先写进去的为准） */
  private saltOf(day: string): Promise<string> {
    let salt = this.salts.get(day)
    if (!salt) {
      salt = (async () => {
        await this.db.insert(analyticsSalts).values({ day, salt: randomBytes(32).toString('hex') }).onDuplicateKeyUpdate({ set: { day } })
        const [row] = await this.db.select({ salt: analyticsSalts.salt }).from(analyticsSalts).where(eq(analyticsSalts.day, day))
        return row!.salt
      })()
      salt.catch(() => this.salts.delete(day))
      // 只留最近两天的
      this.salts.set(day, salt)
      for (const k of [...this.salts.keys()].sort().slice(0, -2)) this.salts.delete(k)
    }
    return salt
  }
}
