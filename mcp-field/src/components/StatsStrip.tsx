import { animate, useInView, useReducedMotion } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import type { Kind, ServerItem } from '../lib/api/entities'
import type { SiteStats } from '../lib/api/home'
import { categoryOf } from '../lib/categories'
import { Container } from './ui'

/** 构成图里的三种颜色：Skills、MCP 服务、其余类型合并 */
const MIX = { skill: '#9B6CE0', server: '#3DDC97', other: '#F2C94C' }
type MixKey = keyof typeof MIX
const OTHER_KINDS: Kind[] = ['client', 'cli', 'agent', 'loop']

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
/** 2026-10-12 → 10/12 */
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

/*
 * 入场动画：每个区块（data-stage）进入视口后加上 data-play，index.css 里 .stats-* 的动画才开始。
 * 服务端渲染出的 HTML 里就是最终数值（爬虫看到的是真实数字），播放前的起始状态只在有 JS 时由 CSS 套上。
 */
function useStage() {
  const ref = useRef<HTMLDivElement>(null)
  const play = useInView(ref, { once: true, amount: 0.5 })
  return [ref, play] as const
}

/** 播放时数字从 0 涨到目标值；播放前输出最终值（那时元素还没显示，见 .stats-in） */
function useTally(value: number, play: boolean, delay: number, duration = 1.5) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(0)
  const animated = play && !reduce
  useEffect(() => {
    if (!animated) return
    const c = animate(0, value, { delay, duration, ease: [0.22, 1, 0.36, 1], onUpdate: setShown })
    return () => c.stop()
  }, [animated, value, delay, duration])
  return animated ? shown : value
}

function Tally({ value, play, delay, format = fmt }: { value: number; play: boolean; delay: number; format?: (n: number) => string }) {
  return <>{format(useTally(value, play, delay))}</>
}

/** 实时标记：带一圈扩散的绿点 */
function Pulse() {
  return (
    <span className="relative flex size-1.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60 [animation-duration:1.8s] motion-reduce:hidden" />
      <span className="relative size-1.5 rounded-full bg-accent shadow-[0_0_6px_#3DDC97]" />
    </span>
  )
}

function Caption({ title, note, accent, live }: { title: string; note?: ReactNode; accent?: boolean; live?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text2">{title}</span>
      {note && (
        <span className={clsx('flex items-center gap-1.5 font-mono text-[11px]', accent ? 'text-accent' : 'text-text3')}>
          {live && <Pulse />}
          {note}
        </span>
      )}
    </div>
  )
}

/**
 * 滚轮计数器：每一位是一条竖排的数字带，播放时从 0 滚到目标数字。
 * 越靠右的位多转几圈、停得越晚，看上去像计数一路涨上来；每一位停下时闪一下。
 */
function Odometer({ value }: { value: number }) {
  const text = fmt(value)
  const count = text.replace(/,/g, '').length
  let pos = 0
  return (
    <div className="flex items-end gap-1">
      <span className="sr-only">{text}</span>
      {Array.from(text).map((ch, i) => {
        if (ch === ',') return <span key={i} aria-hidden className="pb-0.5 font-mono text-[22px] font-semibold text-text3">,</span>
        const p = pos++
        const n = Math.floor((p * 3) / Math.max(count - 1, 1)) * 10 + Number(ch)
        return (
          <span
            key={i}
            aria-hidden
            className="stats-card relative h-12 w-[34px] overflow-hidden rounded-[7px] border border-fg/[0.09] font-mono text-[28px] font-semibold text-ink shadow-[0_3px_8px_rgba(0,0,0,0.35)]"
            style={{
              background: 'linear-gradient(180deg, color-mix(in oklab, var(--mf-fg) 9%, var(--mf-surface)) 50%, var(--mf-subtle) 50%)',
              '--d': '0.1s',
              '--t': `${1.5 + p * 0.12}s`,
            } as CSSProperties}
          >
            {/* 上下边缘渐隐，滚动时像一个转动的鼓 */}
            <span className="absolute -inset-px [mask-image:linear-gradient(transparent,#000_22%,#000_78%,transparent)]">
              <span className="stats-reel flex flex-col" style={{ '--n': n } as CSSProperties}>
                {Array.from({ length: n + 1 }, (_, k) => <span key={k} data-d={k % 10} className="grid h-12 shrink-0 place-items-center" />)}
              </span>
            </span>
            <i className="absolute inset-x-0 top-1/2 h-px bg-black/40" />
          </span>
        )
      })}
    </div>
  )
}

/** 近 14 天每天新上架多少：柱子依次长出来，最后一天高亮；悬停某根柱子时右上角显示那天的数 */
function DailyBars({ daily }: { daily: SiteStats['daily'] }) {
  const { m } = useI18n()
  const [ref, play] = useStage()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...daily.map((d) => d.count), 1)
  const last = daily.at(-1)!
  const added = useTally(last.count, play, 0.3, 1.2)
  const shown = hover === null ? { count: added, date: last.date } : daily[hover]
  return (
    <div ref={ref} data-stage="" data-play={play ? '' : undefined} className="flex flex-col gap-3" title={m.stats.dailyNote}>
      <Caption title={m.stats.daily} note={`+${fmt(shown.count)}  ${md(shown.date)}`} accent />
      <div className="flex h-[52px] items-end gap-[5px]" onMouseLeave={() => setHover(null)}>
        {daily.map((d, i) => {
          const end = i === daily.length - 1
          return (
            <span
              key={d.date}
              aria-label={m.stats.dailyAria(md(d.date), fmt(d.count))}
              title={m.stats.dailyAria(md(d.date), fmt(d.count))}
              onMouseEnter={() => setHover(i)}
              className={clsx('stats-bar flex-1 origin-bottom rounded-t-[3px] rounded-b-[1px] transition-colors', !end && (hover === i ? 'bg-fg/30' : 'bg-fg/[0.12]'))}
              style={{
                height: `${Math.max(4, (d.count / max) * 100)}%`,
                background: end ? 'linear-gradient(180deg, #7DF0BE, #3DDC97)' : undefined,
                boxShadow: end ? '0 0 12px #3DDC9780' : undefined,
                '--d': `${0.2 + i * 0.045}s`,
              } as CSSProperties}
            />
          )
        })}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-text3">
        <span>{md(daily[0].date)}</span>
        <span>{md(daily[Math.floor(daily.length / 2)].date)}</span>
        <span>{md(last.date)}</span>
      </div>
    </div>
  )
}

/**
 * 百格构成：每格约 1%，按 Skills、MCP 服务、其余类型依次排。
 * 播放时从空格子开始逐格点亮，右侧数字同步往上涨；悬停图例或格子时只亮对应那一类，悬停“其他”时提示各类的数量。
 */
function Waffle({ totals }: { totals: SiteStats['totals'] }) {
  const { m } = useI18n()
  const [ref, play] = useStage()
  const [focus, setFocus] = useState<MixKey | null>(null)
  const all = Object.values(totals).reduce((a, b) => a + b, 0) || 1
  const others = OTHER_KINDS.reduce((s, k) => s + totals[k], 0)
  const skillCells = Math.round((totals.skill / all) * 100)
  const otherCells = others > 0 ? Math.max(1, Math.round((others / all) * 100)) : 0
  const serverCells = 100 - skillCells - otherCells
  const kindOf = (i: number): MixKey => (i < skillCells ? 'skill' : i < skillCells + serverCells ? 'server' : 'other')
  const pct = (n: number) => `${((n / all) * 100).toFixed(1)}%`
  const rows: [MixKey, string, number][] = [
    ['skill', m.stats.kinds.skill, totals.skill],
    ['server', m.stats.kinds.server, totals.server],
    ['other', m.stats.others(OTHER_KINDS.length), others],
  ]
  return (
    <div ref={ref} data-stage="" data-play={play ? '' : undefined} className="flex flex-col gap-4 @min-[420px]:flex-row @min-[420px]:items-center @min-[420px]:gap-5">
      <div
        aria-hidden
        className="grid shrink-0 grid-cols-[repeat(20,9px)] gap-[3px]"
        onMouseOver={(e) => {
          const k = (e.target as HTMLElement).dataset.k as MixKey | undefined
          if (k) setFocus(k)
        }}
        onMouseLeave={() => setFocus(null)}
      >
        {Array.from({ length: 100 }, (_, i) => {
          const k = kindOf(i)
          return (
            <i
              key={i}
              data-k={k}
              className="stats-cell size-[9px] rounded-[2px] transition-opacity duration-300"
              style={{ '--c': MIX[k], '--d': `${0.3 + i * 0.012}s`, opacity: focus && focus !== k ? 0.15 : i % 7 === 3 ? 0.7 : 1 } as CSSProperties}
            />
          )
        })}
      </div>
      <div className="flex w-full max-w-[237px] min-w-0 flex-col gap-[7px] @min-[420px]:max-w-none @min-[420px]:flex-1">
        {rows.map(([k, name, n], r) => (
          <div
            key={k}
            title={k === 'other' ? OTHER_KINDS.map((o) => `${m.stats.kinds[o]} ${fmt(totals[o])}`).join(' · ') : undefined}
            onMouseEnter={() => setFocus(k)}
            onMouseLeave={() => setFocus(null)}
            className="stats-in flex cursor-default items-center gap-1.5 text-xs transition-opacity duration-300"
            style={{ opacity: focus && focus !== k ? 0.45 : 1, '--d': `${0.35 + r * 0.08}s` } as CSSProperties}
          >
            <i className="size-2 shrink-0 rounded-[2px]" style={{ background: MIX[k] }} />
            <span className="truncate text-text2">{name}</span>
            <span className="ml-auto font-mono text-ink"><Tally value={n} play={play} delay={0.35} /></span>
            <span className="w-11 text-right font-mono text-[11px] text-text3"><Tally value={n} play={play} delay={0.35} format={pct} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 首屏下方的收录总览：滚轮计数、近 14 天新上架、百格构成，底部一条最新上架。
 * 统计接口失败时整块不显示（stats 为 null）。
 */
export function StatsStrip({ stats, recent }: { stats: SiteStats; recent: ServerItem[] }) {
  const { m, tr, to } = useI18n()
  const [totalRef, totalPlay] = useStage()
  const [recentRef, recentPlay] = useStage()
  const total = Object.values(stats.totals).reduce((a, b) => a + b, 0)
  return (
    <Container className="pt-3.5">
      <div
        className="overflow-hidden rounded-[18px] border border-fg/[0.08]"
        style={{ background: 'radial-gradient(70% 200% at 0% 0%, #3DDC9714, transparent 60%), var(--color-surface)' }}
      >
        <div className="flex flex-col gap-7 px-7 py-6 lg:flex-row lg:items-start lg:gap-6 xl:gap-7">
          <div ref={totalRef} data-stage="" data-play={totalPlay ? '' : undefined} className="flex flex-col gap-3 lg:w-[250px] lg:shrink-0 xl:w-[300px]">
            <Caption title={m.stats.total} note={m.stats.live} accent live />
            <Odometer value={total} />
          </div>
          <i aria-hidden className="hidden h-24 w-px bg-fg/[0.06] lg:block" />
          {stats.daily.length > 0 && (
            <>
              <div className="lg:w-[250px] lg:shrink-0 xl:w-[300px]"><DailyBars daily={stats.daily} /></div>
              <i aria-hidden className="hidden h-24 w-px bg-fg/[0.06] lg:block" />
            </>
          )}
          {/* 百格栏按自身宽度决定图例放右边还是下面（容器查询），宽屏下与左边两栏的图表垂直居中对齐 */}
          <div className="@container min-w-0 flex-1 lg:self-center"><Waffle totals={stats.totals} /></div>
        </div>
        {recent.length > 0 && (
          <div
            ref={recentRef}
            data-stage=""
            data-play={recentPlay ? '' : undefined}
            className="flex items-center gap-[18px] overflow-hidden border-t border-fg/[0.06] bg-fg/[0.025] px-7 py-[11px]"
          >
            <span className="stats-in flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-[3px] text-xs font-medium text-mint" style={{ '--d': '0.1s' } as CSSProperties}>
              <Pulse />
              {m.stats.recent}
            </span>
            {recent.map((s, i) => {
              const cat = categoryOf('server', s.category?.slug)
              return (
                <Link
                  key={s.slug}
                  to={to(`/servers/${s.slug}`)}
                  className={clsx('stats-in min-w-0 max-w-[260px] items-center gap-2 transition-opacity hover:!opacity-100', i < 2 ? 'hidden sm:flex' : 'hidden lg:flex')}
                  style={{ opacity: 1 - i * 0.18, '--d': `${0.25 + i * 0.09}s`, '--from': 'translateX(-10px)' } as CSSProperties}
                >
                  <span className="truncate text-[13px] font-medium text-ink">{s.name}</span>
                  <i className="size-[5px] shrink-0 rounded-full" style={{ background: cat.color }} />
                  <span className="shrink-0 text-xs text-text3">{tr(cat.name)}</span>
                </Link>
              )
            })}
            <Link to={to('/servers?sort=new')} className="stats-in ml-auto flex shrink-0 items-center gap-1 text-xs text-text2 transition-colors hover:text-ink" style={{ '--d': '0.6s' } as CSSProperties}>
              {m.stats.recentMore}<CaretRight size={12} />
            </Link>
          </div>
        )}
      </div>
    </Container>
  )
}
