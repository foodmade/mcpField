import { ArrowSquareOut, TrendDown, TrendUp } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { PageHeader } from '../components/Layout'
import { Card, Empty, ErrorBox, Loading, Select } from '../components/ui'
import { useApi, type AnalyticsBreakdown, type AnalyticsDim, type AnalyticsOverview, type AnalyticsRange, type CrawlerStats } from '../lib/api'
import { compact, num } from '../lib/format'

/*
 * 访问统计：网站自己记录的页面浏览（不含爬虫），加上从 nginx 日志统计的爬虫抓取量。
 * 访客数按天去重；多天的访客数是每天相加（访客标识每天换，跨天认不出同一个人）。
 */

const SITE = 'https://mcpfield.com'

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]

const PAGE_LABEL: Record<string, string> = {
  home: '首页',
  servers: 'MCP 服务列表',
  'servers/*': 'MCP 服务详情',
  'remote-servers': '远程服务列表',
  clients: '客户端列表',
  'clients/*': '客户端详情',
  cli: 'CLI 列表',
  'cli/*': 'CLI 详情',
  skills: 'Skill 列表',
  'skills/*': 'Skill 详情',
  loops: 'Loop 列表',
  'loops/*': 'Loop 详情',
  agents: 'Agent 列表',
  'agents/*': 'Agent 详情',
  tags: '标签',
  rankings: '排行榜',
  blog: '博客列表',
  'blog/*': '博客文章',
  privacy: '隐私政策',
  login: '登录',
}
const DEVICE_LABEL: Record<string, string> = { mobile: '手机', tablet: '平板', desktop: '电脑' }
const LOCALE_LABEL: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }
const regions = new Intl.DisplayNames(['zh-CN'], { type: 'region' })

const PANELS: { dim: AnalyticsDim; title: string; label: (v: string) => ReactNode; wide?: boolean }[] = [
  { dim: 'path', title: '热门页面', wide: true, label: (v) => <PathLink path={v} /> },
  { dim: 'source', title: '来源', label: (v) => v || <span className="text-text3">直接访问</span> },
  { dim: 'page', title: '页面类型', label: (v) => PAGE_LABEL[v] ?? v },
  { dim: 'country', title: '国家或地区', label: (v) => (v === 'XX' ? <span className="text-text3">未知</span> : `${safeRegion(v)} · ${v}`) },
  { dim: 'locale', title: '网站语言', label: (v) => LOCALE_LABEL[v] ?? v },
  { dim: 'device', title: '设备', label: (v) => DEVICE_LABEL[v] ?? v },
  { dim: 'browser', title: '浏览器', label: (v) => v },
  { dim: 'os', title: '系统', label: (v) => v },
]

function safeRegion(code: string) {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

export function AnalyticsPage() {
  const overview = useApi<AnalyticsOverview>('/analytics/overview', 60_000)
  const [range, setRange] = useState<AnalyticsRange>('7d')
  return (
    <>
      <PageHeader title="访问统计" onRefresh={overview.reload} />
      <div className="flex flex-col gap-5 px-8 pb-10 pt-7">
        {overview.error && <ErrorBox error={overview.error} retry={overview.reload} />}
        {overview.loading && !overview.data ? <Loading /> : overview.data && <Summary data={overview.data} />}

        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">访问明细</h2>
          <Select label="时间" value={range} options={RANGES} onChange={setRange} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {PANELS.map((p) => (
            <Breakdown key={p.dim} dim={p.dim} range={range} title={p.title} label={p.label} className={p.wide ? 'col-span-2' : undefined} />
          ))}
        </div>

        <Crawlers />
      </div>
    </>
  )
}

function Summary({ data }: { data: AnalyticsOverview }) {
  const t = data.trend
  const today = t.at(-1)!
  const yesterday = t.at(-2)!
  const sum = (xs: typeof t, k: 'pv' | 'uv') => xs.reduce((n, d) => n + d[k], 0)
  const week = t.slice(-7)
  const prevWeek = t.slice(-14, -7)
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="今日访客" value={today.uv} delta={today.uv - yesterday.uv} deltaLabel="较昨日全天" foot={`访问 ${num(today.visits)} 次 · 昨日访客 ${num(yesterday.uv)}`} />
        <Kpi label="今日浏览量" value={today.pv} delta={today.pv - yesterday.pv} deltaLabel="较昨日全天" foot={`昨日浏览量 ${num(yesterday.pv)}`} />
        <Kpi label="近 7 天访客" value={sum(week, 'uv')} delta={sum(week, 'uv') - sum(prevWeek, 'uv')} deltaLabel="较前 7 天" foot="每天的访客数相加" />
        <Kpi label="近 7 天浏览量" value={sum(week, 'pv')} delta={sum(week, 'pv') - sum(prevWeek, 'pv')} deltaLabel="较前 7 天" foot={`平均每天 ${num(Math.round(sum(week, 'pv') / 7))}`} />
      </div>
      <Card title="近 30 天趋势" sub="浏览量与访客数（按北京时间分天，不含爬虫）" right={<Legend />}>
        <Trend trend={t} />
      </Card>
    </>
  )
}

function Kpi({ label, value, delta, deltaLabel, foot }: { label: string; value: number; delta: number; deltaLabel: string; foot: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-5">
      <span className="text-[13px] text-text2">{label}</span>
      <span className="flex items-end gap-2.5">
        <span className="text-[30px] font-semibold leading-none tracking-tight tabular">{num(value)}</span>
        <span className={clsx('flex items-center gap-1 whitespace-nowrap pb-0.5 text-xs', delta >= 0 ? 'text-ok' : 'text-text3')}>
          {delta >= 0 ? <TrendUp className="size-3.5" /> : <TrendDown className="size-3.5" />}
          {deltaLabel} {delta >= 0 ? '+' : ''}
          {num(delta)}
        </span>
      </span>
      <span className="truncate text-xs text-text3">{foot}</span>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-text2">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-text3/50" />
        浏览量
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-accent" />
        访客数
      </span>
    </div>
  )
}

function niceMax(n: number) {
  if (n <= 10) return 10
  const p = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / p) * p
}

/** 每天两根柱：浏览量在后、访客数在前 */
function Trend({ trend }: { trend: AnalyticsOverview['trend'] }) {
  const max = niceMax(Math.max(...trend.map((d) => d.pv), 1))
  const H = 180
  return (
    <div className="flex gap-2.5">
      <div className="flex h-[180px] flex-col justify-between text-right font-mono text-[10px] text-text3">
        {[max, (max * 2) / 3, max / 3, 0].map((v) => (
          <span key={v}>{compact(Math.round(v))}</span>
        ))}
      </div>
      <div className="flex flex-1 gap-1.5">
        {trend.map((d, i) => (
          <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center gap-2" title={`${d.day}：访客 ${num(d.uv)} · 浏览 ${num(d.pv)} · 访问 ${num(d.visits)} 次`}>
            <div className="relative w-full border-b border-line" style={{ height: H }}>
              {d.pv > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-text3/30 group-hover:bg-text3/45" style={{ height: Math.max(2, (d.pv / max) * H) }} />}
              {d.uv > 0 && <div className="absolute inset-x-[22%] bottom-0 rounded-t-[3px] bg-accent opacity-90 group-hover:opacity-100" style={{ height: Math.max(2, (d.uv / max) * H) }} />}
            </div>
            <span className={clsx('font-mono text-[10px]', i === trend.length - 1 ? 'text-ink' : 'text-text3', i % 3 !== (trend.length - 1) % 3 && 'invisible')}>{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PathLink({ path }: { path: string }) {
  return (
    <a href={`${SITE}${path}`} target="_blank" rel="noreferrer" className="group/link inline-flex min-w-0 items-center gap-1 hover:text-accent">
      <span className="truncate font-mono text-[12.5px]">{path}</span>
      <ArrowSquareOut className="size-3 shrink-0 opacity-0 group-hover/link:opacity-100" />
    </a>
  )
}

function Breakdown({ dim, range, title, label, className }: { dim: AnalyticsDim; range: AnalyticsRange; title: string; label: (v: string) => ReactNode; className?: string }) {
  const { data, error, loading, reload } = useApi<AnalyticsBreakdown>(`/analytics/breakdown?dim=${dim}&range=${range}`)
  const rows = data?.rows.slice(0, dim === 'path' ? 20 : 10) ?? []
  const top = Math.max(...rows.map((r) => r.pv), 1)
  return (
    <Card title={title} sub={dim === 'source' ? '只算打开网站的第一个页面' : undefined} className={className} padded={false}>
      {error ? (
        <div className="px-5 pb-5">
          <ErrorBox error={error} retry={reload} />
        </div>
      ) : loading && !data ? (
        <Loading />
      ) : !rows.length ? (
        <div className="px-5 pb-5">
          <Empty>这段时间还没有数据</Empty>
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-line text-left text-xs text-text3">
              <th className="px-5 py-2 font-normal">{title}</th>
              <th className="w-20 px-3 py-2 text-right font-normal">访客</th>
              <th className="w-20 py-2 pl-3 pr-5 text-right font-normal">{dim === 'source' ? '访问次数' : '浏览量'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.value} className="border-b border-line/60 last:border-0">
                <td className="relative max-w-0 px-5 py-2">
                  <span className="absolute inset-y-1 left-3 rounded bg-accent/[0.08]" style={{ width: `calc(${(r.pv / top) * 100}% - 12px)` }} />
                  <span className="relative flex min-w-0 truncate">{label(r.value)}</span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular text-text2">{num(r.uv)}</td>
                <td className="py-2 pl-3 pr-5 text-right font-mono tabular">{num(r.pv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

const BOT_LABEL: Record<string, string> = {
  googlebot: 'Googlebot',
  'googlebot-image': 'Googlebot 图片',
  googleother: 'GoogleOther',
  'google-inspection': 'Google 网址检查',
  bingbot: 'Bingbot',
  applebot: 'Applebot',
  yandexbot: 'YandexBot',
  baiduspider: '百度',
  duckduckbot: 'DuckDuckBot',
  gptbot: 'GPTBot（OpenAI）',
  'oai-searchbot': 'OAI-SearchBot（ChatGPT 搜索）',
  'chatgpt-user': 'ChatGPT-User',
  claudebot: 'ClaudeBot',
  perplexitybot: 'Perplexity',
  amazonbot: 'Amazonbot',
  bytespider: 'Bytespider（字节）',
  meta: 'Meta',
  ahrefsbot: 'AhrefsBot',
  semrushbot: 'SemrushBot',
  petalbot: 'PetalBot（华为）',
  exabot: 'ExaSearchBot（Exa）',
  keenablebot: 'KeenableBot',
  other: '其他爬虫',
}

function Crawlers() {
  const { data, error, loading, reload } = useApi<CrawlerStats>('/analytics/crawlers?days=14')
  return (
    <Card title="爬虫抓取" sub="近 14 天（到昨天为止），来自服务器 nginx 访问日志；页面被 Cloudflare 缓存时不会到服务器，实际抓取量会多一些" padded={false}>
      {error ? (
        <div className="px-5 pb-5">
          <ErrorBox error={error} retry={reload} />
        </div>
      ) : loading && !data ? (
        <Loading />
      ) : !data?.bots.length ? (
        <div className="px-5 pb-5">
          <Empty>还没有爬虫数据（每天凌晨统计前一天的日志）</Empty>
        </div>
      ) : (
        <CrawlerTable data={data} />
      )}
    </Card>
  )
}

function CrawlerTable({ data }: { data: CrawlerStats }) {
  const max = Math.max(...data.bots.flatMap((b) => Object.values(b.byDay)), 1)
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-y border-line text-left text-xs text-text3">
          <th className="px-5 py-2 font-normal">爬虫</th>
          <th className="px-3 py-2 font-normal">每天请求数</th>
          <th className="w-24 px-3 py-2 text-right font-normal">合计</th>
          <th className="w-20 px-3 py-2 text-right font-normal">4xx</th>
          <th className="w-20 py-2 pl-3 pr-5 text-right font-normal">5xx</th>
        </tr>
      </thead>
      <tbody>
        {data.bots.map((b) => (
          <tr key={b.bot} className="border-b border-line/60 last:border-0">
            <td className="whitespace-nowrap px-5 py-2">{BOT_LABEL[b.bot] ?? b.bot}</td>
            <td className="px-3 py-2">
              <div className="flex h-6 items-end gap-[3px]">
                {data.days.map((day) => {
                  const v = b.byDay[day] ?? 0
                  return <span key={day} title={`${day}：${num(v)}`} className={clsx('w-2.5 rounded-t-[2px]', v ? 'bg-accent/70' : 'bg-line')} style={{ height: v ? Math.max(2, (v / max) * 24) : 2 }} />
                })}
              </div>
            </td>
            <td className="px-3 py-2 text-right font-mono tabular">{num(b.total)}</td>
            <td className={clsx('px-3 py-2 text-right font-mono tabular', b.e4xx ? 'text-warn' : 'text-text3')}>{num(b.e4xx)}</td>
            <td className={clsx('py-2 pl-3 pr-5 text-right font-mono tabular', b.e5xx ? 'text-err' : 'text-text3')}>{num(b.e5xx)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
