import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, CaretLeft, CaretRight, CheckCircle, Pause, Play, Star, Wrench } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AuroraBanner } from '../fx/Aurora'
import { CountUp } from '../fx/CountUp'
import { SplitText } from '../fx/Reveal'
import { TiltCard, glass } from '../fx/TiltCard'
import { useEnterAnimation } from '../fx/hydration'
import { CodeTypewriter } from '../fx/Typewriter'
import { useI18n } from '../i18n/context'
import type { Locale } from '../i18n/locales'
import { fetchDetail, type ServerDetail, type ServerItem } from '../lib/api/entities'
import { useApi } from '../lib/api/useApi'
import { categoryOf } from '../lib/categories'
import { buildLocalConfig, buildRemoteConfig, colorTokens, localSpec } from '../lib/config'
import { developerOf } from '../lib/entity'
import { EntityIcon } from './EntityIcon'
import { RoundBtn, ShimmerButton } from './ui'

const MotionLink = motion.create(Link)
const ease = [0.22, 1, 0.36, 1] as const
const INTERVAL = 6

/** 首屏配置片段：远程服务给远程地址，本地服务给安装包启动命令；都没有时不显示 */
function configCode(d: ServerDetail): string | null {
  const key = d.slug.replace(/^mcp-server-|^mcp-|-mcp-server$|-mcp$/g, '') || d.slug
  const remote = d.remotes[0]
  if (remote) return buildRemoteConfig(key, remote.url, 'cursor', remote.transport)
  const spec = localSpec(d)
  return spec ? buildLocalConfig(key, spec) : null
}

/**
 * 一次性预取所有推荐的配置片段，切换时内容已就绪，不会在动画结束后才弹出。
 * 返回 slug → 配置；undefined = 还在加载，null = 没有可展示的配置
 */
function useSlideConfigs(slides: ServerItem[], locale: Locale) {
  const key = slides.length ? `hero:configs:${locale}:${slides.map((s) => s.slug).join(',')}` : null
  const res = useApi(key, (signal) =>
    Promise.all(
      slides.map((s) =>
        fetchDetail('server', s.slug, locale, signal).then(configCode, (e: unknown) => {
          if (signal.aborted) throw e
          return null
        }),
      ),
    ),
  )
  return useMemo(() => new Map(slides.map((s, k) => [s.slug, res.data?.[k]])), [slides, res.data])
}

/** 配置片段区域固定高度：加载中、没有配置时也占同样的位置，切换时卡片不跳动 */
function SlideConfig({ code }: { code: string | null | undefined }) {
  const { m } = useI18n()
  // 语法着色结果要稳定，否则每次重新渲染都会让打字机从头开始
  const lines = useMemo(() => (code ? colorTokens(code) : null), [code])
  return (
    <div className="h-[190px] overflow-hidden rounded-[10px] border border-white/10 bg-black/35 px-3.5 py-3">
      {lines ? (
        <CodeTypewriter lines={lines} className="h-full overflow-auto font-mono text-[13px] leading-[1.6] [scrollbar-width:none]" />
      ) : code === undefined ? (
        <div className="flex animate-pulse flex-col gap-2.5 pt-1" aria-hidden>
          {[40, 62, 54, 70, 48].map((w, k) => <div key={k} className="h-3 rounded bg-white/[0.07]" style={{ width: `${w}%` }} />)}
        </div>
      ) : (
        <p className="text-sm text-white/45">{m.detail.noInstall}</p>
      )}
    </div>
  )
}

const slideVariants = {
  enter: (d: number) => ({ opacity: 0, x: 28 * d, scale: 0.985 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.65, ease } },
  exit: (d: number) => ({ opacity: 0, x: -28 * d, scale: 0.985, transition: { duration: 0.4, ease } }),
}

/** 首屏推荐轮播：推荐条目由首页 loader 取回，配置片段在浏览器里预取 */
export function Hero({ slides }: { slides: ServerItem[] }) {
  const { m, tr, locale, to } = useI18n()
  const enter = useEnterAnimation()
  const configs = useSlideConfigs(slides, locale)
  const [i, setI] = useState(0)
  const [dir, setDir] = useState(1)
  const [paused, setPaused] = useState(false)
  const go = (d: number) => {
    if (!slides.length) return
    setDir(d)
    setI((v) => (v + d + slides.length) % slides.length)
  }
  useEffect(() => {
    if (paused || !slides.length) return
    const id = setTimeout(() => go(1), INTERVAL * 1000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, paused, slides.length])
  const s = slides[Math.min(i, slides.length - 1)]
  const cat = s ? categoryOf('server', s.category?.slug) : null
  const tag = cat ? `${m.hero.weekly} · ${tr(cat.name)}` : m.hero.weekly

  return (
    <AuroraBanner className="min-h-[460px]">
      <div className="grid items-center gap-10 px-6 py-10 sm:px-8 lg:grid-cols-[1fr_460px] lg:px-16 lg:py-12 [&>*]:min-w-0">
        <div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tag}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease }}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-[#9FF0CB]"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-70" />
                <span className="relative size-1.5 rounded-full bg-accent" />
              </span>
              {tag}
            </motion.div>
          </AnimatePresence>
          <SplitText key={locale} text={m.hero.title} className="mt-5 text-4xl font-bold leading-[1.15] tracking-[-0.02em] md:text-[52px]" delay={0.1} />
          <motion.p initial={enter ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.8 }} className="mt-5 text-base text-white/70">
            {m.hero.sub}
          </motion.p>
          <motion.div className="mt-6 flex flex-wrap gap-2.5" initial={enter ? 'h' : false} animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.06, delayChildren: 0.85 } } }}>
            {slides.map((t, k) => (
              <motion.button
                key={t.slug}
                aria-label={m.hero.tileAria(t.name)}
                variants={{ h: { opacity: 0, scale: 0.4, y: 12 }, s: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 18 } } }}
                whileHover={{ y: -6, rotate: -6, scale: 1.08 }}
                onClick={() => {
                  setDir(k > i ? 1 : -1)
                  setI(k)
                }}
                className="rounded-xl border border-white/15 shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
              >
                <EntityIcon name={t.name} src={t.iconUrl} color={categoryOf('server', t.category?.slug).color} size={48} className="!rounded-xl" />
              </motion.button>
            ))}
          </motion.div>
          <motion.div initial={enter ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.25 }} className="mt-7">
            <ShimmerButton>{m.hero.browse}</ShimmerButton>
          </motion.div>
        </div>

        <div className="flex flex-col gap-4">
          <TiltCard>
            <div className={`${glass} overflow-hidden p-[22px]`} style={{ background: 'radial-gradient(120% 100% at 100% 0%, #3DDC9733, transparent 60%), rgba(255,255,255,0.06)' }}>
              {!s || !cat ? (
                <div className="flex animate-pulse flex-col gap-4" aria-hidden>
                  <div className="flex h-[45px] items-center gap-3"><div className="size-11 rounded-[11px] bg-white/10" /><div className="h-5 w-40 rounded bg-white/10" /></div>
                  <div className="h-[2lh] text-sm leading-relaxed"><div className="h-4 w-full rounded bg-white/[0.07]" /></div>
                  <div className="h-[190px] rounded-[10px] bg-black/25" />
                  <div className="h-[34px]" />
                </div>
              ) : (
              // 新旧两张叠在同一个网格单元里交叉淡入淡出，容器高度不变
              <div className="grid [&>*]:[grid-area:1/1]">
              <AnimatePresence custom={dir} initial={false}>
                <motion.div
                  key={s.slug}
                  custom={dir}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex min-w-0 flex-col gap-4 will-change-transform"
                >
                  <div className="flex items-center gap-3">
                    <EntityIcon name={s.name} src={s.iconUrl} color={cat.color} size={44} className="!rounded-[11px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[19px] font-semibold"><span className="truncate">{s.name}</span>{s.verified && <CheckCircle weight="bold" className="shrink-0 text-accent" size={16} />}</div>
                      <div className="truncate text-xs text-white/55">{[developerOf(s), tr(cat.name)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/80">{m.hero.pick}</span>
                  </div>
                  <p className="line-clamp-2 h-[2lh] text-sm leading-relaxed text-white/70">{s.tagline}</p>
                  <SlideConfig code={configs.get(s.slug)} />
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3.5 text-xs text-white/55">
                      {s.stars !== null && <span className="flex items-center gap-1"><Star size={14} /><CountUp value={s.stars} /></span>}
                      {s.toolsCount > 0 && <span className="flex items-center gap-1"><Wrench size={14} />{m.hero.tools(s.toolsCount)}</span>}
                    </div>
                    <MotionLink to={to(`/servers/${s.slug}`)} whileTap={{ scale: 0.96 }} className="flex h-[34px] items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-bg">
                      {m.hero.details}<ArrowUpRight size={14} weight="bold" />
                    </MotionLink>
                  </div>
                </motion.div>
              </AnimatePresence>
              </div>
              )}
            </div>
          </TiltCard>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div className="mr-3 hidden items-center gap-1.5 sm:flex">
              {slides.map((_, k) => (
                <button
                  key={k}
                  onClick={() => {
                    setDir(k > i ? 1 : -1)
                    setI(k)
                  }}
                  className="relative h-1 overflow-hidden rounded-full bg-white/20 transition-[width] duration-500"
                  style={{ width: k === i ? 40 : 8 }}
                  aria-label={m.hero.slide(k + 1)}
                >
                  {k === i && (
                    <motion.span
                      key={`${i}-${paused}`}
                      className="absolute inset-y-0 left-0 bg-accent"
                      initial={{ width: paused ? '100%' : '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: paused ? 0 : INTERVAL, ease: 'linear' }}
                    />
                  )}
                </button>
              ))}
            </div>
            <RoundBtn label={m.hero.prev} onClick={() => go(-1)}><CaretLeft size={14} /></RoundBtn>
            <span className="w-11 text-center tabular-nums text-sm text-white/80">{i + 1} / {slides.length}</span>
            <RoundBtn label={m.hero.next} onClick={() => go(1)}><CaretRight size={14} /></RoundBtn>
            <RoundBtn label={paused ? m.hero.play : m.hero.pause} onClick={() => setPaused((p) => !p)}>{paused ? <Play size={14} /> : <Pause size={14} />}</RoundBtn>
          </div>
        </div>
      </div>
    </AuroraBanner>
  )
}
