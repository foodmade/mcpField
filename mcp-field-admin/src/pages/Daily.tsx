import { ArrowsClockwise, CalendarBlank, CaretDown, CaretLeft, CaretRight, Lightbulb, Play, TerminalWindow } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { ItemTable, LightLegend } from '../components/ItemTable'
import { PageHeader } from '../components/Layout'
import { stepResult } from '../components/Steps'
import { Button, Card, Dot, Empty, ErrorBox, Loading, Pill, TONE_BG, toneOf } from '../components/ui'
import { api, qs, useApi, type Daily, type ItemPage, type Run, type Step } from '../lib/api'
import { clock, clockSec, duration, num, shiftDate, todayBeijing, weekday } from '../lib/format'
import { KIND_LABEL, KINDS, STATE_TONE, stepLabel, type Kind } from '../lib/labels'

/** 支持补跑失败片段的步骤（后端 RETRYABLE_STEPS） */
const RETRYABLE = new Set(['readme'])

/** 失败的步骤给一句处理建议 */
function advice(step: Step): string | null {
  const text = [step.error, ...step.runs.flatMap((r) => r.logTail.map((l) => `${l.msg} ${l.detail ?? ''}`))].join(' ')
  if (/429|rate.?limit|Too Many Requests|额度|quota/i.test(text)) return '模型服务限流或额度不足。所有步骤都是增量的，额度恢复后直接重新运行，已完成的部分不会重做。'
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed/i.test(text)) return '网络或外部服务连接失败，通常重新运行即可。'
  if (/Deadlock|Lock wait timeout|ER_/i.test(text)) return '数据库冲突或超时，确认没有同时在跑的同名任务后重新运行。'
  if (step.status === 'interrupted') return '进程被停止（手动 stop、部署重启或内存不足被杀）。重新运行会从断点继续。'
  return null
}

export function DailyPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const today = todayBeijing()
  const date = params.get('date') ?? today
  const { data, error, loading, reload } = useApi<Daily>(`/daily${qs({ date })}`, (d) => (d?.batch?.status === 'running' ? 15_000 : 60_000))
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>()

  // 从仪表盘点进来的 #step-xxx / #items：数据到了再滚过去
  useEffect(() => {
    if (data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [data, location.hash])

  const setDate = (d: string) => setParams((p) => (p.set('date', d), p.delete('page'), p))

  const run = async (label: string, request: Promise<unknown>) => {
    try {
      await request
      setNotice({ ok: true, text: `已在服务器后台开始${label}，几秒后刷新可以看到进度` })
      setTimeout(() => void reload(), 4000)
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message })
    }
  }
  const rerun = (step: string) => {
    if (confirm(`在服务器后台重新运行「${stepLabel(step)}」？`)) void run(`运行「${stepLabel(step)}」`, api('/actions/run', { method: 'POST', body: { step } }))
  }
  const retryFailed = (step: string) => {
    if (confirm(`在服务器后台补跑「${stepLabel(step)}」中多次失败过的片段？`)) void run(`补跑「${stepLabel(step)}」的失败片段`, api('/actions/run', { method: 'POST', body: { step, retryFailed: true } }))
  }
  const runAll = () => {
    if (confirm('在服务器后台立即跑一遍完整的每日任务？（和定时任务共用一把锁，已经在跑时不会重复启动）')) void run('每日任务', api('/actions/daily', { method: 'POST', body: { steps: [] } }))
  }

  return (
    <>
      <PageHeader title="每日采集" sub="每天北京时间 03:30 自动运行；任意一步失败不影响后面的步骤" onRefresh={reload} />
      <div className="flex flex-col gap-5 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex h-9.5 items-center gap-1 rounded-lg border border-line bg-surface px-1.5">
              <button onClick={() => setDate(shiftDate(date, -1))} className="rounded p-1 text-text2 hover:bg-white/5" aria-label="前一天">
                <CaretLeft className="size-4" />
              </button>
              <label className="flex items-center gap-2 px-2">
                <CalendarBlank className="size-4 text-text2" />
                <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent text-sm font-semibold outline-none [color-scheme:dark]" />
                <span className="text-sm text-text2">{weekday(date)}</span>
              </label>
              <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} className="rounded p-1 text-text2 hover:bg-white/5 disabled:opacity-30" aria-label="后一天">
                <CaretRight className="size-4" />
              </button>
            </div>
            {data && (
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-text3">近 14 天</span>
                <div className="flex gap-1">
                  {data.history.map((h) => (
                    <button
                      key={h.date}
                      onClick={() => setDate(h.date)}
                      title={`${h.date}：${h.status ? STATE_TONE[h.status].label : '没有运行记录'}`}
                      className={clsx('h-[22px] w-3.5 rounded-[3px]', h.status ? TONE_BG[toneOf(h.status)] : 'border border-line', h.date === date ? 'ring-[1.5px] ring-ink ring-offset-1 ring-offset-bg' : 'opacity-75 hover:opacity-100')}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5 max-lg:justify-end">
            <Link to="/logs" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[13px] text-text2 hover:bg-white/5 hover:text-ink">
              <TerminalWindow className="size-[15px]" />
              运行日志
            </Link>
            <Button primary icon={<Play className="size-[15px]" />} onClick={runAll}>
              手动运行
            </Button>
          </div>
        </div>

        {notice && <p className={clsx('rounded-lg px-4 py-2.5 text-[13px]', notice.ok ? 'bg-ok/10 text-ok' : 'bg-err/10 text-err')}>{notice.text}</p>}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : (
          data && (
            <>
              <Summary data={data} />
              <StepTable data={data} onRerun={rerun} onRetryFailed={retryFailed} />
              {data.manual.length > 0 && <ManualRuns runs={data.manual} />}
              <NewItems date={date} newByKind={data.newByKind} />
            </>
          )
        )}
      </div>
    </>
  )
}

function Summary({ data }: { data: Daily }) {
  const b = data.batch
  const total = Object.values(data.newByKind).reduce((a, n) => a + n, 0)
  const count = (s: Step['status']) => b?.steps.filter((x) => x.status === s).length ?? 0
  const steps = b ? [count('succeeded') && `${count('succeeded')} 成功`, count('warning') && `${count('warning')} 警告`, count('failed') && `${count('failed')} 失败`, count('interrupted') && `${count('interrupted')} 中断`, count('running') && `${count('running')} 运行中`, count('queued') && `${count('queued')} 排队`].filter(Boolean).join(' · ') : '—'
  const cells: [string, ReactNode][] = [
    ['状态', b ? <Pill state={b.status} /> : <span className="text-text3">没有运行</span>],
    ['开始', b ? clockSec(b.startedAt) : '—'],
    [b?.status === 'running' ? '已用时' : '用时', b ? duration(b.durationMs) : '—'],
    ['步骤', steps],
    ['新收录', `${num(total)} 条`],
    ['触发方式', b ? (b.trigger === 'cron' ? '定时任务' : '手动') : '—'],
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:flex lg:gap-0 lg:bg-surface">
      {cells.map(([label, value], i) => (
        <div key={label} className={clsx('flex flex-col gap-1.5 bg-surface px-4 py-3 md:px-5 md:py-4', label === '步骤' ? 'lg:flex-[2]' : 'lg:flex-1', i < cells.length - 1 && 'lg:border-r lg:border-line')}>
          <span className="text-xs text-text3">{label}</span>
          <span className="text-sm font-semibold md:text-[15px]">{value}</span>
        </div>
      ))}
    </div>
  )
}

const COLS = 'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[230px_110px_70px_90px_1fr_220px_100px] md:gap-y-0'

function StepTable({ data, onRerun, onRetryFailed }: { data: Daily; onRerun: (step: string) => void; onRetryFailed: (step: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const steps = data.batch?.steps ?? []
  if (!data.batch) return <Card title="步骤明细"><Empty>这一天没有每日任务的运行记录</Empty></Card>
  const isOpen = (s: Step) => open.has(s.step) !== (s.status === 'failed' || s.status === 'interrupted')
  const toggle = (step: string) => setOpen((o) => new Set(o.has(step) ? [...o].filter((x) => x !== step) : [...o, step]))
  return (
    <Card title="步骤明细" sub="点击一行展开这一步的统计和最后几条警告、错误；失败的步骤默认展开" padded={false}>
      <div className={clsx(COLS, 'border-y border-line bg-white/[0.02] px-5 py-2.5 text-xs text-text3 max-md:hidden')}>
        <span>步骤</span>
        <span>状态</span>
        <span>开始</span>
        <span>耗时</span>
        <span>进度 / 结果</span>
        <span>成功 · 待抽查 · 失败</span>
        <span className="text-right">操作</span>
      </div>
      {steps.map((s, i) => {
        const expanded = isOpen(s)
        const bad = s.status === 'failed' || s.status === 'interrupted'
        return (
          <Fragment key={s.step}>
            <div id={`step-${s.step}`} onClick={() => s.runs.length && toggle(s.step)} className={clsx(COLS, 'min-h-[52px] scroll-mt-20 border-b border-line px-4 py-3 text-[13px] md:px-5 md:py-2', s.runs.length && 'cursor-pointer hover:bg-white/[0.02]', bad && 'bg-err/[0.05]')}>
              <span className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-text3">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <span className="flex items-center gap-1 font-semibold">
                    {stepLabel(s.step)}
                    {s.runs.length > 0 && <CaretDown className={clsx('size-3 text-text3 transition', !expanded && '-rotate-90')} />}
                  </span>
                  <span className="block font-mono text-[10px] text-text3">
                    {s.step}
                    {s.runs.length > 0 && <span className="md:hidden"> · {clock(s.startedAt)} 开始 · {duration(s.durationMs)}</span>}
                  </span>
                </span>
              </span>
              <span className="max-md:justify-self-end">
                <Pill state={s.status} />
              </span>
              <span className="font-mono text-xs text-text2 max-md:hidden">{clock(s.startedAt)}</span>
              <span className={clsx('text-xs max-md:hidden', s.status === 'running' ? 'text-run' : 'text-text2')}>{s.runs.length ? duration(s.durationMs) : '—'}</span>
              <span className="text-xs text-text2 max-md:col-span-2 md:pr-4">
                {s.progress ? (
                  <span className="flex flex-col gap-1.5">
                    <span className="flex justify-between">
                      <span>
                        {num(s.progress.done)} / {num(s.progress.total)}
                      </span>
                      <span className="font-mono text-run">{Math.floor((s.progress.done / Math.max(1, s.progress.total)) * 100)}%</span>
                    </span>
                    <span className="h-1 rounded-full bg-white/[0.06]">
                      <span className="block h-full rounded-full bg-run" style={{ width: `${(s.progress.done / Math.max(1, s.progress.total)) * 100}%` }} />
                    </span>
                  </span>
                ) : (
                  <span className={clsx('break-all', bad && 'text-err')}>{s.error ? s.error.slice(0, 120) : s.runs.map((r) => r.args).filter(Boolean).join('；') || stepResult(s)}</span>
                )}
              </span>
              <span className="flex items-center gap-3 font-mono text-xs">
                {s.runs.length ? (
                  <>
                    <Count state="ok" n={s.counts.ok} />
                    <Count state="warn" n={s.counts.review} />
                    <Count state="failed" n={s.counts.failed} />
                  </>
                ) : (
                  <span className="text-text3">—</span>
                )}
              </span>
              <span className="text-right">
                {(bad || s.status === 'warning') && (
                  <button onClick={(e) => (e.stopPropagation(), onRerun(s.step))} className="inline-flex items-center gap-1 rounded-md border border-err/40 px-2 py-1 text-xs text-err hover:bg-err/10">
                    <ArrowsClockwise className="size-3" />
                    重新运行
                  </button>
                )}
                {!bad && s.status !== 'warning' && s.runs.length > 0 && (
                  <Link to={`/logs?name=${s.step === 'crawl' ? 'daily' : s.step}`} onClick={(e) => e.stopPropagation()} className="text-xs text-text2 hover:text-ink">
                    日志
                  </Link>
                )}
              </span>
            </div>
            {expanded && <StepDetail step={s} onRetryFailed={onRetryFailed} />}
          </Fragment>
        )
      })}
      {data.batch.extra.length > 0 && <p className="px-4 py-3 text-xs text-text3 md:px-5">另有 {data.batch.extra.map((r) => stepLabel(r.step)).join('、')} 也属于这一批次</p>}
    </Card>
  )
}

function Count({ state, n }: { state: 'ok' | 'warn' | 'failed'; n: number }) {
  return (
    <span className={clsx('flex items-center gap-1.5', !n && 'opacity-40')}>
      <Dot state={state} size={6} />
      {num(n)}
    </span>
  )
}

function StepDetail({ step, onRetryFailed }: { step: Step; onRetryFailed: (step: string) => void }) {
  const tip = advice(step)
  return (
    <div className={clsx('flex flex-col gap-3 border-b border-line py-3.5 pl-4 pr-4 md:pl-[60px] md:pr-5', (step.status === 'failed' || step.status === 'interrupted') && 'bg-err/[0.05]')}>
      {step.runs.map((r) => (
        <RunBlock key={r.id} run={r} />
      ))}
      {tip && (
        <p className="flex items-center gap-1.5 text-xs text-text3">
          <Lightbulb className="size-3.5" />
          {tip}
        </p>
      )}
      {RETRYABLE.has(step.step) && step.status !== 'running' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text3">
          <span>内容上多次失败的片段（没有结构化结果、校验不通过、输出被截断）会被记下，之后的运行都跳过，重新运行不会再翻。</span>
          <button onClick={() => onRetryFailed(step.step)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-text2 hover:bg-white/5 hover:text-ink">
            <ArrowsClockwise className="size-3" />
            补跑失败片段
          </button>
        </p>
      )}
    </div>
  )
}

function RunBlock({ run }: { run: Run }) {
  const [summary, setSummary] = useState<unknown>()
  const lines = run.logTail
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text2">
        <Dot state={run.status} size={7} />
        <span className="break-all font-mono">
          #{run.id} {run.step} {run.args}
        </span>
        <span className="text-text3">
          {clockSec(run.startedAt)} → {run.finishedAt ? clockSec(run.finishedAt) : '运行中'} · {duration(run.durationMs)}
        </span>
        <button onClick={() => (summary ? setSummary(undefined) : void api<Run>(`/runs/${run.id}`).then((r) => setSummary(r.summary ?? {})))} className="text-accent hover:underline">
          {summary ? '收起统计' : '完整统计'}
        </button>
      </div>
      {summary !== undefined && <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] text-text2">{JSON.stringify(summary, null, 2)}</pre>}
      {run.error && <p className="font-mono text-xs text-err">错误：{run.error}</p>}
      {lines.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-line bg-bg px-3.5 py-2.5 font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} className={l.level === 'error' ? 'text-err' : 'text-warn'}>
              [{clockSec(l.at)}] {l.msg}
              {l.detail && <span className="text-text3"> {l.detail}</span>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text3">没有警告和错误日志</p>
      )}
    </div>
  )
}

function ManualRuns({ runs }: { runs: Run[] }) {
  return (
    <Card title="当天的其他运行" sub="不在每日任务批次里、单独启动的命令（mcpfield run、后台重新运行）">
      <div className="flex flex-col gap-4">
        {runs.map((r) => (
          <RunBlock key={r.id} run={r} />
        ))}
      </div>
    </Card>
  )
}

function NewItems({ date, newByKind }: { date: string; newByKind: Record<Kind, number> }) {
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') as Kind | null) ?? undefined
  const onlyIssues = params.get('issue') === 'fail'
  const page = Number(params.get('page') ?? 1)
  const { data, error, loading } = useApi<ItemPage>(`/items${qs({ date, kind, issue: onlyIssues && 'fail', page, pageSize: 20 })}`)
  const total = Object.values(newByKind).reduce((a, n) => a + n, 0)
  const set = (k: string, v: string | null) => setParams((p) => (v === null ? p.delete(k) : p.set(k, v), k !== 'page' && p.delete('page'), p), { preventScrollReset: true })

  return (
    <section id="items" className="scroll-mt-20 rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-3.5 px-4 pt-4 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-[15px] font-semibold">当天新收录 · {num(total)} 条</h2>
            <span className="text-xs text-text3">每条的补全进度；新条目的分类要等次日 classify 后生效</span>
          </div>
          <LightLegend />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 border-b border-line">
          <div className="flex gap-5 overflow-x-auto max-md:w-full md:gap-6">
            {[undefined, ...KINDS].map((k) => (
              <button key={k ?? 'all'} onClick={() => set('kind', k ?? null)} className={clsx('flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-2.5 text-sm md:-mb-px', kind === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-text2 hover:text-ink')}>
                {k ? KIND_LABEL[k] : '全部'}
                <span className="font-mono text-xs text-text3">{num(k ? newByKind[k] : total)}</span>
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-xs text-text2 max-md:order-first">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => set('issue', e.target.checked ? 'fail' : null)} className="accent-[var(--st-err)]" />
            只看有失败的
          </label>
        </div>
      </div>
      {error && (
        <div className="p-5">
          <ErrorBox error={error} />
        </div>
      )}
      {loading && !data ? <Loading /> : data && <ItemTable page={data} showKind={!kind} onPage={(p) => set('page', String(p))} />}
    </section>
  )
}
