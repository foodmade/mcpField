import { ArrowsClockwise, TrendDown, TrendUp } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BatchBadge, batchHeadline, DetailLink, StepStrip } from '../components/Steps'
import { PageHeader } from '../components/Layout'
import { Card, Dot, ErrorBox, Loading, TONE_TEXT } from '../components/ui'
import { useApi, type Coverage, type Dashboard } from '../lib/api'
import { compact, dateTime, num } from '../lib/format'
import { KIND_LABEL, KINDS, STAGE_COMMAND, STAGE_LABEL, STAGES, stepLabel, type Kind, type Stage } from '../lib/labels'

const SERIES = [
  { key: 'server', label: 'MCP 服务', color: 'bg-accent', kinds: ['server'] as Kind[] },
  { key: 'skill', label: 'Skill', color: 'bg-kind-skill', kinds: ['skill'] as Kind[] },
  { key: 'other', label: '其他', color: 'bg-kind-other', kinds: ['client', 'cli', 'agent', 'loop'] as Kind[] },
]

/** 覆盖率表的列：数量少的三类合成一列 */
const COVERAGE_COLUMNS: { label: string; kinds: Kind[] }[] = [
  { label: 'MCP 服务', kinds: ['server'] },
  { label: 'Skill', kinds: ['skill'] },
  { label: '客户端', kinds: ['client'] },
  { label: 'CLI · Agent · Loop', kinds: ['cli', 'agent', 'loop'] },
]

export function DashboardPage() {
  // 任务运行中每 20 秒刷新，平时每分钟
  const { data, error, loading, reload } = useApi<Dashboard>('/dashboard', (d) => (d?.batch?.status === 'running' ? 20_000 : 60_000))
  return (
    <>
      <PageHeader title="仪表盘" onRefresh={reload} />
      <div className="flex flex-col gap-5 px-4 pb-10 pt-4 md:px-8 md:pt-7">
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? <Loading /> : data && <Body data={data} />}
      </div>
    </>
  )
}

function Body({ data }: { data: Dashboard }) {
  const head = batchHeadline(data.batch)
  const today = data.daily.at(-1)
  const yesterday = data.daily.at(-2)
  const total = Object.values(data.totals).reduce((a, b) => a + b, 0)
  const week = data.daily.slice(-7).reduce((n, d) => n + d.total, 0)
  const failing = Object.values(data.failingItems).reduce((a, b) => a + (b ?? 0), 0)
  const openIssues = data.issues.filter((i) => !i.resolved)
  const Icon = head.icon

  return (
    <>
      <section className={clsx('rounded-xl border bg-surface p-4 md:p-6', head.tone === 'err' ? 'border-err/35' : 'border-line')}>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className={clsx('flex size-11 shrink-0 items-center justify-center rounded-full', head.tone === 'err' ? 'bg-err/12' : head.tone === 'ok' ? 'bg-ok/12' : head.tone === 'warn' ? 'bg-warn/12' : 'bg-run/12')}>
              <Icon className={clsx('size-6', TONE_TEXT[head.tone])} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-lg font-semibold md:truncate md:text-xl">{head.title}</h2>
                {data.batch && <BatchBadge batch={data.batch} />}
              </div>
              <p className="mt-1 text-[13px] text-text2 md:truncate">{head.sub}</p>
            </div>
          </div>
          <DetailLink date={data.today} />
        </div>
        {data.batch && (
          <div className="mt-5">
            <StepStrip batch={data.batch} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Kpi label="今日新收录" value={num(today?.total)} delta={today && yesterday ? today.total - yesterday.total : undefined} deltaLabel="较昨日" foot={SERIES.map((s) => `${s.label} ${num(s.kinds.reduce((n, k) => n + (today?.byKind[k] ?? 0), 0))}`).join(' · ')} />
        <Kpi label="平台条目总数" value={num(total)} delta={week} deltaLabel="近 7 天" foot={KINDS.slice(0, 3).map((k) => `${KIND_LABEL[k]} ${num(data.totals[k])}`).join(' · ')} />
        <Kpi
          label="有失败步骤的条目"
          value={num(failing)}
          danger={failing > 0}
          foot={
            <Link to="/items?issue=fail&kind=server" className="hover:text-ink">
              {KINDS.filter((k) => data.failingItems[k]).map((k) => `${KIND_LABEL[k]} ${num(data.failingItems[k])}`).join(' · ') || '没有'}
            </Link>
          }
        />
        <Kpi label="待处理异常" value={num(openIssues.length)} danger={openIssues.length > 0} foot={openIssues[0] ? `${stepLabel(openIssues[0].step)}：${openIssues[0].message ?? '见运行详情'}` : '最近 7 天没有未恢复的异常'} />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <Card title="近 14 日新收录" sub="按收录日期统计 · 柱下圆点为当天每日任务的结果" className="min-w-0 flex-1" right={<Legend />}>
          <Chart daily={data.daily} />
        </Card>
        <Card title="今日新收录 · 按类型" sub={`${data.today} 共 ${num(today?.total ?? 0)} 条`} className="xl:w-[380px] xl:shrink-0">
          <TodayKinds byKind={today?.byKind} date={data.today} />
        </Card>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        <Card title="补全覆盖率 · 按类型" sub="在架条目中已完成该项的比例（不适用的不计）；点数字查看待处理的条目" className="min-w-0 flex-1">
          <CoverageTable coverage={data.coverage} />
        </Card>
        <Card title="异常与待处理" sub={`最近 7 天 · 未恢复 ${openIssues.length} 项`} className="xl:w-[420px] xl:shrink-0" right={<Link to="/logs" className="text-xs text-accent">运行日志</Link>}>
          <Issues issues={data.issues} />
        </Card>
      </div>
    </>
  )
}

function Kpi({ label, value, delta, deltaLabel, foot, danger }: { label: string; value: string; delta?: number; deltaLabel?: string; foot: ReactNode; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-surface p-4 md:p-5">
      <span className="text-[13px] text-text2">{label}</span>
      <span className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className={clsx('text-[26px] font-semibold leading-none tracking-tight tabular md:text-[30px]', danger && 'text-err')}>{value}</span>
        {delta !== undefined && (
          <span className={clsx('flex items-center gap-1 whitespace-nowrap pb-0.5 text-xs', delta >= 0 ? 'text-ok' : 'text-text3')}>
            {delta >= 0 ? <TrendUp className="size-3.5" /> : <TrendDown className="size-3.5" />}
            {deltaLabel} {delta >= 0 ? '+' : ''}
            {num(delta)}
          </span>
        )}
      </span>
      <span className="truncate text-xs text-text3">{foot}</span>
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {SERIES.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5 text-xs text-text2">
          <span className={clsx('size-2.5 rounded-sm', s.color)} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function niceMax(n: number) {
  if (n <= 10) return 10
  const p = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / p) * p
}

function Chart({ daily }: { daily: Dashboard['daily'] }) {
  const max = niceMax(Math.max(...daily.map((d) => d.total), 1))
  const H = 200
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="flex min-w-[520px] gap-2.5">
        <div className="flex h-[200px] flex-col justify-between pb-0 text-right font-mono text-[10px] text-text3">
          {[max, (max * 2) / 3, max / 3, 0].map((v) => (
            <span key={v}>{compact(Math.round(v))}</span>
          ))}
        </div>
        <div className="flex flex-1 gap-2.5">
          {daily.map((d, i) => {
            const last = i === daily.length - 1
            return (
              <Link key={d.date} to={`/daily?date=${d.date}`} className="group flex min-w-0 flex-1 flex-col items-center gap-2" title={`${d.date}：${num(d.total)} 条`}>
                <div className="flex w-full flex-col justify-end gap-px border-b border-line" style={{ height: H }}>
                  {d.total === 0 && d.status === 'failed' ? (
                    <div className="flex h-full items-center justify-center rounded border border-err/30 bg-err/5 text-[10px] text-err">失败</div>
                  ) : (
                    SERIES.map((s, j) => {
                      const v = s.kinds.reduce((n, k) => n + d.byKind[k], 0)
                      if (!v) return null
                      const top = SERIES.slice(j + 1).every((x) => !x.kinds.reduce((n, k) => n + d.byKind[k], 0))
                      return <div key={s.key} className={clsx(s.color, 'w-full opacity-90 group-hover:opacity-100', top && 'rounded-t-[3px]')} style={{ height: Math.max(3, (v / max) * H), order: -j }} />
                    })
                  )}
                </div>
                <span className={clsx('font-mono text-[10px]', last ? 'text-ink' : 'text-text3')}>{d.date.slice(5)}</span>
                {d.status ? <Dot state={d.status} size={7} /> : <span className="size-[7px] rounded-full border border-line" title="没有运行记录" />}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TodayKinds({ byKind, date }: { byKind?: Record<Kind, number>; date: string }) {
  const max = Math.max(1, ...KINDS.map((k) => byKind?.[k] ?? 0))
  return (
    <div className="flex flex-col gap-3">
      {KINDS.map((k) => {
        const n = byKind?.[k] ?? 0
        return (
          <Link key={k} to={`/daily?date=${date}&kind=${k}#items`} className="flex flex-col gap-1.5 hover:opacity-90">
            <span className="flex items-center justify-between text-[13px]">
              <span className={n ? 'font-medium' : 'text-text3'}>{KIND_LABEL[k]}</span>
              <span className={clsx('font-mono font-semibold tabular', !n && 'text-text3')}>{num(n)}</span>
            </span>
            <span className="h-1.5 rounded-full bg-white/[0.04]">
              {n > 0 && <span className={clsx('block h-full rounded-full', k === 'server' ? 'bg-accent' : k === 'skill' ? 'bg-kind-skill' : 'bg-kind-other')} style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function CoverageTable({ coverage }: { coverage: Coverage[] }) {
  const cell = (stage: Stage, kinds: Kind[]) => {
    const rows = coverage.filter((c) => c.stage === stage && kinds.includes(c.kind))
    const sum = (k: 'ok' | 'warn' | 'failed' | 'pending') => rows.reduce((n, r) => n + r[k], 0)
    const applicable = sum('ok') + sum('warn') + sum('failed') + sum('pending')
    if (!applicable) return null
    // 完成率只算完全完成的；警告（没有图标、仓库不存在、待抽查……）和失败、待处理一样算没完成
    return { pct: (sum('ok') / applicable) * 100, failed: sum('failed'), pending: sum('pending'), warn: sum('warn') }
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-text3">
            <th className="w-[180px] py-2 font-normal">补全项</th>
            {COVERAGE_COLUMNS.map((c) => (
              <th key={c.label} className="py-2 font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAGES.map((stage) => (
            <tr key={stage} className="border-b border-line last:border-0">
              <td className="py-2">
                <div>{STAGE_LABEL[stage]}</div>
                <div className="font-mono text-[10px] text-text3">{STAGE_COMMAND[stage]}</div>
              </td>
              {COVERAGE_COLUMNS.map((col) => {
                const c = cell(stage, col.kinds)
                if (!c) return <td key={col.label} className="font-mono text-xs text-text3">—</td>
                const tone = c.pct >= 95 ? 'bg-ok' : c.pct >= 80 ? 'bg-warn' : 'bg-err'
                return (
                  <td key={col.label} className="pr-4">
                    <Link to={`/items?kind=${col.kinds[0]}&stage=${stage}&stageState=${c.failed ? 'failed' : 'pending'}`} className="flex items-center gap-2" title={`失败 ${num(c.failed)} · 警告 ${num(c.warn)} · 待处理 ${num(c.pending)}`}>
                      <span className="w-12 font-mono text-xs tabular">{c.pct >= 99.95 ? '100%' : `${c.pct.toFixed(1)}%`}</span>
                      <span className="h-1 flex-1 rounded-full bg-white/[0.05]">
                        <span className={clsx('block h-full rounded-full', tone)} style={{ width: `${c.pct}%` }} />
                      </span>
                      {c.failed > 0 && <span className="font-mono text-[10px] text-err">{num(c.failed)}</span>}
                    </Link>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Issues({ issues }: { issues: Dashboard['issues'] }) {
  if (!issues.length) return <p className="py-10 text-center text-sm text-text3">最近 7 天没有失败、警告或中断的运行</p>
  return (
    <ul className="flex flex-col">
      {issues.map((i) => (
        <li key={i.id} className="flex gap-3 border-b border-line py-3 last:border-0">
          <span className="pt-1">
            <Dot state={i.resolved ? 'succeeded' : i.status} size={8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={clsx('text-[13px] font-semibold', i.resolved && 'text-text2')}>
              {stepLabel(i.step)} {i.status === 'failed' ? '失败' : i.status === 'interrupted' ? '中断' : `${num(i.counts.failed)} 条失败`}
              {i.resolved && <span className="ml-2 text-xs font-normal text-ok">之后已恢复</span>}
            </p>
            <p className="mt-1 line-clamp-2 break-all text-xs leading-relaxed text-text3">
              {dateTime(i.startedAt)} · {i.message ?? '见运行详情'}
            </p>
          </div>
          <Link to={`/daily?date=${dayOf(i.startedAt)}#step-${i.step}`} className="h-fit shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-text2 hover:text-ink">
            {i.resolved ? '查看' : <span className="flex items-center gap-1"><ArrowsClockwise className="size-3" />处理</span>}
          </Link>
        </li>
      ))}
    </ul>
  )
}

const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
