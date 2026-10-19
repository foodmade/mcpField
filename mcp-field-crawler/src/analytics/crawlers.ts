import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'

/*
 * 爬虫抓取量：从 nginx 访问日志里数各爬虫每天的请求数（按状态码分）。爬虫不执行 JS，访问统计的明细里没有它们。
 * 日志是 combined 格式，时间是服务器时区（北京时间），直接按日志里的日期分天。
 * logrotate 每天轮转一次、保留 10 份（mcpfield.com.access.log、-YYYYMMDD、-YYYYMMDD.gz），某一天的行可能分在相邻两个文件里，所以全部读一遍再按日期归。
 */

/** 按顺序匹配，先具体后笼统：GoogleOther、Googlebot-Image 要排在 Googlebot 前面 */
const BOTS: [name: string, re: RegExp][] = [
  ['googleother', /GoogleOther/],
  ['googlebot-image', /Googlebot-Image/],
  ['google-inspection', /Google-InspectionTool/],
  ['googlebot', /Googlebot/],
  ['bingbot', /bingbot|BingPreview|msnbot/i],
  ['applebot', /Applebot/i],
  ['yandexbot', /YandexBot/],
  ['baiduspider', /Baiduspider/],
  ['duckduckbot', /DuckDuckBot/],
  ['gptbot', /GPTBot/],
  ['oai-searchbot', /OAI-SearchBot/],
  ['chatgpt-user', /ChatGPT-User/],
  ['claudebot', /ClaudeBot|Claude-SearchBot|Claude-User/],
  ['perplexitybot', /PerplexityBot|Perplexity-User/],
  ['amazonbot', /Amazonbot/],
  ['bytespider', /Bytespider/],
  ['meta', /meta-externalagent|facebookexternalhit/],
  ['ahrefsbot', /AhrefsBot/],
  ['semrushbot', /SemrushBot/],
  ['petalbot', /PetalBot/],
  ['exabot', /ExaSearchBot/],
  ['keenablebot', /KeenableBot|Keenable-User/],
  ['other', /bot\b|bot\/|crawl|spider|slurp/i],
]

export function botOf(ua: string): string | null {
  for (const [name, re] of BOTS) if (re.test(ua)) return name
  return null
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
/** [15/Oct/2026:09:52:33 +0800] "GET / HTTP/2.0" 200 25313 "-" "UA" */
const LINE = /\[(\d{2})\/(\w{3})\/(\d{4}):[^\]]*\] "[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/

export function parseLine(line: string): { day: string; status: number; ua: string } | null {
  const m = LINE.exec(line)
  const month = m && MONTHS[m[2]!]
  if (!m || !month) return null
  return { day: `${m[3]}-${month}-${m[1]}`, status: Number(m[4]), ua: m[5]! }
}

export interface CrawlerCounts {
  /** 日志里最早的一天：通常只覆盖了半天，不能当完整数据 */
  firstDay: string | null
  /** 每天的总行数 */
  totals: Map<string, number>
  /** 每天 → "爬虫|状态码" → 请求数 */
  hits: Map<string, Map<string, number>>
}

/** 当前日志和所有轮转文件（.gz 解压读） */
export async function logFiles(accessLog: string): Promise<string[]> {
  const dir = dirname(accessLog)
  const base = basename(accessLog)
  const names = await readdir(dir)
  return names.filter((n) => n === base || n.startsWith(`${base}-`)).map((n) => join(dir, n))
}

export async function countCrawlers(files: string[]): Promise<CrawlerCounts> {
  const counts: CrawlerCounts = { firstDay: null, totals: new Map(), hits: new Map() }
  for (const file of files) {
    const stream = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file)
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      const row = parseLine(line)
      if (!row) continue
      if (!counts.firstDay || row.day < counts.firstDay) counts.firstDay = row.day
      counts.totals.set(row.day, (counts.totals.get(row.day) ?? 0) + 1)
      const bot = botOf(row.ua)
      if (!bot) continue
      let day = counts.hits.get(row.day)
      if (!day) counts.hits.set(row.day, (day = new Map()))
      const key = `${bot}|${row.status}`
      day.set(key, (day.get(key) ?? 0) + 1)
    }
  }
  return counts
}
