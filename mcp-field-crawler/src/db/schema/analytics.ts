import { bigint, boolean, char, date, index, int, mysqlTable, primaryKey, smallint, varchar } from 'drizzle-orm/mysql-core'
import { at, pk } from './columns.ts'

/*
 * 访问统计：网站自己记录页面浏览（前端 sendBeacon → POST /api/collect），不用 Cookie、不存 IP。
 * 访客标识 = SHA-256(当天的随机盐 + IP + User-Agent)，盐每天换一个、两天后删除，跨天无法关联同一个人，也无法从标识反查 IP。
 * "天"一律按北京时间（与后台其他页面一致）。明细保留 90 天；前一天的明细由后台接口进程汇总进 analytics_daily，历史查询只读汇总表。
 * 爬虫抓取量来自 nginx 访问日志（爬虫不执行 JS，不会出现在明细里），每天解析一次写进 crawler_daily。
 */

/** 每天的随机盐：API 进程重启后仍用同一个，当天的访客不会被算成两个 */
export const analyticsSalts = mysqlTable('analytics_salts', {
  day: date('day', { mode: 'string' }).primaryKey(),
  salt: char('salt', { length: 64 }).notNull(),
})

/** 页面浏览明细：一次浏览一行（首次打开和站内跳转都算） */
export const analyticsEvents = mysqlTable(
  'analytics_events',
  {
    id: pk(),
    day: date('day', { mode: 'string' }).notNull(),
    at: at('at').notNull(),
    /** 访客标识（哈希的前 32 位十六进制） */
    visitor: char('visitor', { length: 32 }).notNull(),
    /** 是否是一次访问的第一个页面（打开网站时；站内跳转为 false）；来源只记在第一个页面上 */
    entry: boolean('entry').notNull(),
    /** 路径（不含查询参数，含语言前缀） */
    path: varchar('path', { length: 512 }).notNull(),
    /** 页面类型：home、servers（列表）、servers/*（详情）…… */
    page: varchar('page', { length: 32 }).notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    /** 来源网站的域名，直接访问和站内跳转为空字符串 */
    source: varchar('source', { length: 255 }).notNull().default(''),
    /** Cloudflare 给出的国家或地区代码（CF-IPCountry），未知为 XX */
    country: char('country', { length: 2 }).notNull().default('XX'),
    /** mobile / tablet / desktop */
    device: varchar('device', { length: 8 }).notNull(),
    browser: varchar('browser', { length: 16 }).notNull(),
    os: varchar('os', { length: 16 }).notNull(),
  },
  (t) => [index('ix_analytics_events_day_visitor').on(t.day, t.visitor)],
)

/**
 * 每日汇总：dim 是维度（total 总计、page 页面类型、path 路径、source 来源、country、device、browser、os、locale），value 是取值。
 * pv 浏览量、uv 当天的独立访客数、visits 访问次数（第一个页面的浏览数）。path 每天只留浏览量前 200 的路径
 */
export const analyticsDaily = mysqlTable(
  'analytics_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    dim: varchar('dim', { length: 16 }).notNull(),
    value: varchar('value', { length: 512 }).notNull(),
    pv: int('pv', { unsigned: true }).notNull(),
    uv: int('uv', { unsigned: true }).notNull(),
    visits: int('visits', { unsigned: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.dim, t.value] })],
)

/** 爬虫每天的请求数：bot 是爬虫名称（googlebot、bingbot……），status 是 HTTP 状态码；bot = _all、status = 0 那一行是当天的日志总行数，也表示这一天已经解析过 */
export const crawlerDaily = mysqlTable(
  'crawler_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    bot: varchar('bot', { length: 32 }).notNull(),
    status: smallint('status', { unsigned: true }).notNull(),
    hits: bigint('hits', { mode: 'number', unsigned: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.bot, t.status] })],
)
