import { ArrowRight, CheckCircle, Clock, WarningOctagon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Link } from 'react-router'
import type { Batch, Step } from '../lib/api'
import { clock, duration, num } from '../lib/format'
import { stepLabel } from '../lib/labels'
import { Pill, TONE_BG, TONE_TEXT, toneOf } from './ui'

/** 一步的一句话结果：进度、耗时或失败原因 */
export function stepResult(s: Step): string {
  if (s.status === 'running') return s.progress ? `${Math.floor((s.progress.done / Math.max(1, s.progress.total)) * 100)}%` : '进行中'
  if (s.status === 'queued') return '排队'
  if (s.status === 'skipped') return '未运行'
  if (s.status === 'failed') return '失败'
  if (s.status === 'interrupted') return '中断'
  if (s.status === 'warning') return `${num(s.counts.failed)} 条失败`
  return duration(s.durationMs)
}

/** 仪表盘横幅里的步骤条 */
export function StepStrip({ batch }: { batch: Batch }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 xl:flex">
      {batch.steps.map((s, i) => {
        const tone = toneOf(s.status)
        return (
          <Link
            key={s.step}
            to={`/daily?date=${batch.date}#step-${s.step}`}
            className={clsx('flex min-w-0 flex-1 flex-col gap-2 rounded-lg border p-2.5 hover:bg-white/[0.04]', tone === 'err' ? 'border-err/40 bg-err/[0.06]' : 'border-line bg-white/[0.02]')}
          >
            <span className={clsx('h-[3px] rounded-full', TONE_BG[tone], s.status === 'running' && 'animate-pulse')} />
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-text3">{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate text-[13px] font-semibold">{stepLabel(s.step)}</span>
            </span>
            <span className="font-mono text-[10px] text-text3">{s.startedAt ? `${clock(s.startedAt)} 开始` : '—'}</span>
            <span className={clsx('truncate text-xs', tone === 'ok' || tone === 'idle' ? 'text-text2' : TONE_TEXT[tone])}>{stepResult(s)}</span>
          </Link>
        )
      })}
    </div>
  )
}

/** 今天任务的总体情况：一句话标题 + 副标题 */
export function batchHeadline(batch: Batch | null, now = Date.now()) {
  if (!batch) return { tone: 'idle' as const, title: '今天还没有运行记录', sub: '每日任务北京时间 03:30 自动开始', icon: Clock }
  const failed = batch.steps.filter((s) => s.status === 'failed').length
  const interrupted = batch.steps.filter((s) => s.status === 'interrupted').length
  const warned = batch.steps.filter((s) => s.status === 'warning').length
  const done = batch.steps.filter((s) => s.status !== 'queued' && s.status !== 'running' && s.status !== 'skipped').length
  const current = batch.steps.find((s) => s.status === 'running')
  const problems = [failed && `${failed} 个步骤失败`, interrupted && `${interrupted} 个步骤中断`, warned && `${warned} 个步骤有警告`].filter(Boolean).join(' · ')
  const elapsed = (batch.finishedAt ? new Date(batch.finishedAt).getTime() : now) - new Date(batch.startedAt).getTime()
  const sub = [
    `${clock(batch.startedAt)} 开始`,
    batch.status === 'running' ? `已运行 ${duration(elapsed)}` : `用时 ${duration(elapsed)}`,
    current && `当前步骤 ${stepLabel(current.step)}${current.progress ? `：${num(current.progress.done)} / ${num(current.progress.total)}` : ''}`,
    batch.trigger === 'manual' && '手动触发',
  ]
    .filter(Boolean)
    .join(' · ')
  const title =
    batch.status === 'running' ? `今日任务运行中${problems ? ` · ${problems}` : ''}` : batch.status === 'interrupted' && !problems ? '今日任务被中断' : problems ? `今日任务已结束 · ${problems}` : '今日任务全部成功'
  const tone = failed || interrupted ? ('err' as const) : batch.status === 'running' ? ('run' as const) : warned ? ('warn' as const) : ('ok' as const)
  return { tone, title, sub, icon: tone === 'err' ? WarningOctagon : tone === 'ok' ? CheckCircle : Clock, done, total: batch.steps.length }
}

export function BatchBadge({ batch }: { batch: Batch }) {
  const done = batch.steps.filter((s) => s.status !== 'queued' && s.status !== 'running').length
  return <Pill state={batch.status} label={batch.status === 'running' ? `${done} / ${batch.steps.length} 步` : undefined} />
}

export function DetailLink({ date }: { date: string }) {
  return (
    <Link to={`/daily?date=${date}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-[13px] font-semibold text-bg hover:bg-white">
      查看当天详情
      <ArrowRight className="size-[15px]" />
    </Link>
  )
}
