import { motion } from 'motion/react'
import { ArrowUpRight, CaretLeft, CaretRight, Check, CheckCircle, Copy, Pause, Play } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Flashlight, type FieldEntry } from '../fx/flashlight'
import { SplitText } from '../fx/Reveal'
import { useEnterAnimation } from '../fx/hydration'
import { useI18n } from '../i18n/context'
import type { Locale } from '../i18n/locales'
import { fetchDetail, ROUTE, type ServerDetail, type ServerItem, type SkillDetail } from '../lib/api/entities'
import { fetchField, type FieldItem } from '../lib/api/home'
import { useApi } from '../lib/api/useApi'
import { categoryOf, compactNumber } from '../lib/categories'
import { serverCommand } from '../lib/config'
import { developerOf } from '../lib/entity'
import { EntityIcon } from './EntityIcon'
import { ShimmerButton } from './ui'

const ease = [0.22, 1, 0.36, 1] as const
const INTERVAL = 6

const keyOf = (i: FieldItem) => `${i.kind}:${i.slug}`
const colorOf = (i: FieldItem) => categoryOf(i.kind, i.category).color

/** 编辑推荐（首页 loader 取回的服务）转成卡片条目 */
const fromServer = (s: ServerItem): FieldItem => ({
  kind: 'server',
  slug: s.slug,
  name: s.name,
  category: s.category?.slug ?? null,
  tagline: s.tagline,
  iconUrl: s.iconUrl,
  author: developerOf(s),
  verified: s.verified || s.official,
  metric: s.stars,
  toolsCount: s.toolsCount,
  isRemote: s.isRemote,
})

/* 详情缓存：气泡起飞时预取，落进卡片时多半已经到了；推荐卡来回切换也不重复请求 */
type Detail = ServerDetail | SkillDetail
const detailCache = new Map<string, Promise<Detail>>()
function loadDetail(i: FieldItem, locale: Locale): Promise<Detail> {
  const key = `${locale}:${keyOf(i)}`
  let p = detailCache.get(key)
  if (!p) {
    p = fetchDetail(i.kind, i.slug, locale)
    p.catch(() => detailCache.delete(key))
    detailCache.set(key, p)
    if (detailCache.size > 60) detailCache.delete(detailCache.keys().next().value!)
  }
  return p
}

/** 卡片里的接入命令：undefined = 详情还在加载，null = 没有可展示的 */
function commandOf(i: FieldItem, d: Detail | undefined): string | null | undefined {
  if (i.kind === 'skill') return i.installCommand ?? (d ? ((d as SkillDetail).installCommand ?? null) : undefined)
  return d ? serverCommand(d as ServerDetail) : undefined
}

function CopyLine({ text }: { text: string }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          /* 剪贴板不可用时仍给出反馈 */
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      className="flex h-[26px] shrink-0 items-center gap-1 rounded-[7px] bg-fg/[0.06] px-2 text-xs text-fg/70 transition-colors hover:bg-fg/10 hover:text-ink"
    >
      {copied ? <><Check size={12} weight="bold" className="text-accent" />{m.hero.copied}</> : <><Copy size={12} />{m.hero.copy}</>}
    </button>
  )
}

const item = { hidden: { opacity: 0, y: 8, filter: 'blur(4px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.46, ease } } }
const content = {
  hidden: {},
  show: { opacity: 1, filter: 'blur(0px)', transition: { staggerChildren: 0.042, delayChildren: 0.06 } },
  dim: { opacity: 0.25, filter: 'blur(2px)', transition: { duration: 0.22 } },
}

/**
 * 推荐卡：展示编辑推荐，或用户在背景里选中的条目。列表字段（图标、名称、简介、星数）立即显示，
 * AI 导读、特性、接入命令来自详情，到达后补上。departing = 气泡在路上，旧内容先退半步。
 */
function LiveCard({ entry, pick, departing, cardRef, iconRef }: { entry: FieldItem; pick: boolean; departing: boolean; cardRef: React.Ref<HTMLElement>; iconRef: React.Ref<HTMLSpanElement> }) {
  const { m, tr, to, locale } = useI18n()
  // 服务端渲染出的第一张卡直接显示最终状态（不拖慢首屏），之后换条目时才播放入场动画
  const enter = useEnterAnimation()
  const firstKey = useRef(keyOf(entry))
  const animateIn = enter || keyOf(entry) !== firstKey.current
  const detail = useApi(`hero:detail:${locale}:${keyOf(entry)}`, () => loadDetail(entry, locale))
  const d = detail.data
  const cat = categoryOf(entry.kind, entry.category)
  const overview = d?.overview
  const cmd = commandOf(entry, d)
  const chips = entry.kind === 'server'
    ? [(d as ServerDetail | undefined)?.runtime, ...((d as ServerDetail | undefined)?.transports ?? []), entry.toolsCount ? m.hero.tools(entry.toolsCount) : null, entry.isRemote ? m.hero.remote : null]
    : [tr(cat.name)]
  const stats = entry.kind === 'server'
    ? [entry.metric !== null ? `★ ${compactNumber(entry.metric)}` : null, entry.toolsCount ? m.hero.tools(entry.toolsCount) : null, entry.isRemote ? m.hero.remote : null]
    : [entry.metric !== null ? m.hero.installs(compactNumber(entry.metric)) : null, entry.author ? m.hero.by(entry.author) : null]

  return (
    <article
      ref={cardRef}
      data-fx-solid
      aria-live="polite"
      className="fx-card relative flex h-[352px] flex-col rounded-2xl border border-fg/[0.07] px-[22px] pb-[18px] pt-[22px] backdrop-blur-[9px]"
      style={{ '--tint': cat.color, background: 'linear-gradient(180deg, color-mix(in srgb, var(--hero-card) 78%, transparent), color-mix(in srgb, var(--hero-card) 62%, transparent))' } as CSSProperties}
    >
      <motion.div key={keyOf(entry)} variants={content} initial={animateIn ? 'hidden' : false} animate={departing ? 'dim' : 'show'} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-[42px] items-center gap-3">
          <motion.span
            ref={iconRef}
            variants={{ hidden: { scale: 0.35, opacity: 0 }, show: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 420, damping: 16 } } }}
            className="shrink-0"
          >
            <EntityIcon name={entry.name} src={entry.iconUrl} color={cat.color} size={42} className="!rounded-[11px]" />
          </motion.span>
          <motion.div variants={item} className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-lg font-semibold"><span className="truncate">{entry.name}</span>{entry.verified && <CheckCircle weight="bold" className="shrink-0 text-accent" size={15} />}</div>
            <div className="truncate text-xs text-fg/45">{[entry.author, tr(cat.name)].filter(Boolean).join(' · ')}</div>
          </motion.div>
          <motion.span variants={item} className="flex shrink-0 items-center gap-1.5 self-start pt-1 text-xs text-fg/70">
            <i className="size-[5px] rounded-full" style={{ background: cat.color, boxShadow: `0 0 6px ${cat.color}` }} />
            {pick ? m.hero.pick : entry.kind === 'server' ? m.hero.kindServer : m.hero.kindSkill}
          </motion.span>
        </div>

        <motion.p variants={item} className="mt-3.5 line-clamp-3 min-h-[calc(3*1.65*13.5px)] text-[13.5px] leading-[1.65] text-fg/70">
          {overview?.summary ?? entry.tagline ?? m.hero.noIntro}
        </motion.p>

        <motion.ul variants={item} className="mt-3 flex flex-col gap-1.5">
          {overview?.features.length ? (
            overview.features.slice(0, 3).map((f) => (
              <li key={f} className="flex items-center gap-2 text-[12.5px] text-fg/60">
                <i className="size-1 shrink-0 rounded-full opacity-80" style={{ background: cat.color }} />
                <span className="truncate">{f}</span>
              </li>
            ))
          ) : detail.loading ? (
            [62, 48, 55].map((w) => <li key={w} className="h-3 animate-pulse rounded bg-fg/[0.06]" style={{ width: `${w}%` }} />)
          ) : (
            <li className="flex flex-wrap gap-1.5">
              {chips.filter(Boolean).map((c) => <span key={c} className="rounded-md border border-fg/10 px-1.5 py-px font-mono text-[11.5px] text-fg/65">{c}</span>)}
            </li>
          )}
        </motion.ul>

        <motion.div
          variants={item}
          className="mt-auto flex items-center gap-2.5 rounded-r-lg border-l-2 py-2 pl-3 pr-1.5"
          style={{ borderColor: `${cat.color}80`, background: 'linear-gradient(90deg, rgba(255,255,255,0.03), transparent)' }}
        >
          {cmd === undefined ? (
            <span className="h-3 w-3/5 animate-pulse rounded bg-fg/[0.06]" />
          ) : cmd ? (
            <>
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-amber">{cmd}</code>
              <CopyLine text={cmd} />
            </>
          ) : (
            <span className="text-xs text-fg/35">{m.hero.installHint}</span>
          )}
        </motion.div>

        <motion.div variants={item} className="mt-3.5 flex items-center justify-between border-t border-fg/[0.05] pt-3.5">
          <div className="flex gap-3.5 whitespace-nowrap text-xs text-fg/50">{stats.filter(Boolean).map((s) => <span key={s}>{s}</span>)}</div>
          <Link
            to={to(`/${ROUTE[entry.kind]}/${entry.slug}`)}
            className="flex h-8 items-center gap-1.5 rounded-[9px] border border-fg/15 px-3 text-[13px] font-medium text-ink transition-colors hover:border-fg/25 hover:bg-fg/[0.06]"
          >
            {m.hero.details}<ArrowUpRight size={13} weight="bold" />
          </Link>
        </motion.div>
      </motion.div>
    </article>
  )
}

/**
 * 首屏：背景是"手电筒"里流动的服务名与 Skill 名（fx/flashlight.ts），右侧是实时推荐卡。
 * 没人操作时卡片轮播编辑推荐；在背景名字上停一下或点它，名字化成气泡飞进卡片，卡片换成它。
 */
export function Hero({ slides, total }: { slides: ServerItem[]; total: number | null }) {
  const { m, tr, locale } = useI18n()
  const enter = useEnterAnimation()
  const picks = useMemo(() => slides.map(fromServer), [slides])
  const [pickIdx, setPickIdx] = useState(0)
  const [shown, setShown] = useState<{ entry: FieldItem; pick: boolean } | null>(null)
  const [departing, setDeparting] = useState(false)
  const [playing, setPlaying] = useState(true)
  const [userPicked, setUserPicked] = useState(false)
  const [lit, setLit] = useState(0)

  const bannerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const engine = useRef<Flashlight | null>(null)
  const localeRef = useRef(locale)
  localeRef.current = locale

  const field = useApi(`hero:field:${locale}`, (signal) => fetchField(locale, signal))
  const byKey = useRef(new Map<string, FieldItem>())
  const entries = useMemo<FieldEntry[]>(() => {
    const list = field.data ?? []
    byKey.current = new Map(list.map((i) => [keyOf(i), i]))
    return list.map((i) => ({ key: keyOf(i), name: i.name, color: colorOf(i), iconUrl: i.iconUrl }))
  }, [field.data])

  const current = shown ?? (picks[0] ? { entry: picks[pickIdx] ?? picks[0], pick: true } : null)

  // 画布只在浏览器里创建；回调通过 ref 读取最新的条目表
  useEffect(() => {
    const host = bannerRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const fl = new Flashlight({
      canvas,
      host,
      card: () => cardRef.current,
      icon: () => iconRef.current,
      onLit: setLit,
      onSelect: () => setUserPicked(true),
      onLaunch: (e) => {
        const it = byKey.current.get(e.key)
        if (it) void loadDetail(it, localeRef.current).catch(() => {})
        setDeparting(true)
      },
      onArrive: (e) => {
        const it = byKey.current.get(e.key)
        setDeparting(false)
        if (it) setShown({ entry: it, pick: false })
      },
    })
    engine.current = fl
    return () => {
      fl.destroy()
      engine.current = null
    }
  }, [])

  const currentKey = current ? keyOf(current.entry) : null
  useEffect(() => engine.current?.setEntries(entries), [entries])
  useEffect(() => engine.current?.setCurrent(currentKey), [currentKey, entries])

  const showPick = (k: number) => {
    if (!picks.length) return
    const i = (k + picks.length) % picks.length
    setPickIdx(i)
    setShown({ entry: picks[i], pick: true })
    setUserPicked(false)
    setDeparting(false)
  }
  // 自动轮播：用户在背景里选过条目后停下
  useEffect(() => {
    if (!playing || userPicked || picks.length < 2) return
    const id = setTimeout(() => showPick(pickIdx + 1), INTERVAL * 1000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, userPicked, pickIdx, picks.length])

  const tagCat = picks[pickIdx] ? categoryOf('server', picks[pickIdx].category) : null
  const tag = tagCat ? `${m.hero.weekly} · ${tr(tagCat.name)}` : m.hero.weekly

  return (
    <div
      ref={bannerRef}
      // 首屏横幅在两种主题下都保持深色
      data-theme="dark"
      className="hero-banner relative isolate overflow-hidden rounded-[22px] border border-fg/[0.08] [touch-action:pan-y]"
    >
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 -z-10 size-full" />
      <p className="sr-only">{m.hero.fieldAria}</p>
      {total !== null && (
        <div aria-hidden className="pointer-events-none absolute right-5 top-3.5 z-10 hidden items-center gap-2 text-xs text-fg/50 sm:flex">
          {m.hero.litBefore}<b className="font-mono font-medium text-mint">{lit.toLocaleString('en-US')}</b>{m.hero.litAfter(total.toLocaleString('en-US'))}
        </div>
      )}

      <div className="pointer-events-none grid min-h-[460px] items-center gap-10 px-6 py-10 sm:px-8 lg:grid-cols-[1fr_460px] lg:px-16 [&>*]:min-w-0">
        <div>
          <motion.div
            key={tag}
            initial={enter ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease }}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-mint"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative size-1.5 rounded-full bg-accent" />
            </span>
            {tag}
          </motion.div>
          <SplitText key={locale} text={m.hero.title} className="mt-5 text-4xl font-bold leading-[1.15] tracking-[-0.02em] [text-shadow:0_2px_24px_var(--hero-shade)] md:text-[52px]" delay={0.1} />
          <motion.p initial={enter ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.8 }} className="mt-5 text-base text-fg/70 [text-shadow:0_1px_12px_var(--hero-shade)]">
            {m.hero.sub}
          </motion.p>
          <motion.div className="mt-6 flex flex-wrap gap-2.5" initial={enter ? 'h' : false} animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.06, delayChildren: 0.85 } } }}>
            {picks.map((t, k) => (
              <motion.button
                key={t.slug}
                type="button"
                aria-label={m.hero.tileAria(t.name)}
                variants={{ h: { opacity: 0, scale: 0.4, y: 12 }, s: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 18 } } }}
                whileHover={{ y: -6, rotate: -6, scale: 1.08 }}
                onClick={() => showPick(k)}
                className="pointer-events-auto rounded-xl border border-fg/15 shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
              >
                <EntityIcon name={t.name} src={t.iconUrl} color={colorOf(t)} size={48} className="!rounded-xl" />
              </motion.button>
            ))}
          </motion.div>
          <motion.div initial={enter ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.25 }} className="pointer-events-auto mt-7 inline-block">
            <ShimmerButton>{m.hero.browse}</ShimmerButton>
          </motion.div>
        </div>

        <div className="pointer-events-auto flex flex-col">
          {current ? (
            <LiveCard entry={current.entry} pick={current.pick} departing={departing} cardRef={cardRef} iconRef={iconRef} />
          ) : (
            <div ref={cardRef as React.Ref<HTMLDivElement>} className="h-[352px] rounded-2xl border border-fg/[0.07] bg-[color-mix(in_srgb,var(--hero-card)_65%,transparent)]" />
          )}
          {picks.length > 1 && (
            <div className="mt-4 flex items-center justify-between px-1">
              <div className={clsx('flex gap-1.5 transition-opacity duration-300', userPicked && 'opacity-35')} aria-hidden>
                {picks.map((_, k) => (
                  <span key={k} className="h-0.5 overflow-hidden rounded-full bg-fg/15 transition-[width] duration-500" style={{ width: k === pickIdx ? 36 : 18 }}>
                    {k === pickIdx && !userPicked && (
                      // CSS 动画（缩放）而不是 motion 逐帧改宽度：不占主线程，也不会每秒产生几十次 DOM 变化让 Clarity 录制
                      <span
                        key={`${pickIdx}-${playing}`}
                        className="block h-full origin-left bg-accent"
                        style={playing ? { animation: `hero-progress ${INTERVAL}s linear` } : undefined}
                      />
                    )}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-0.5 text-fg/55">
                <button type="button" aria-label={m.hero.prev} onClick={() => showPick(pickIdx - 1)} className="grid size-7 place-items-center rounded-lg transition-colors hover:bg-fg/[0.06] hover:text-ink"><CaretLeft size={14} /></button>
                <span className="w-10 text-center font-mono text-xs tabular-nums">{pickIdx + 1} / {picks.length}</span>
                <button type="button" aria-label={m.hero.next} onClick={() => showPick(pickIdx + 1)} className="grid size-7 place-items-center rounded-lg transition-colors hover:bg-fg/[0.06] hover:text-ink"><CaretRight size={14} /></button>
                <button type="button" aria-label={playing ? m.hero.pause : m.hero.play} onClick={() => setPlaying((p) => !p)} className="grid size-7 place-items-center rounded-lg transition-colors hover:bg-fg/[0.06] hover:text-ink">
                  {playing ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
