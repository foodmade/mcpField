import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, CaretDown, Check, ClockCounterClockwise, Crown, Medal, ShareNetwork, ShieldCheck, SortDescending, Star, Trophy, X, type Icon } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams, type ShouldRevalidateFunctionArgs } from 'react-router'
import clsx from 'clsx'
import { SearchBox } from '../components/directory/Sidebar'
import { EntityIcon } from '../components/EntityIcon'
import { Seo } from '../components/Seo'
import { CountUp } from '../fx/CountUp'
import { useEnterAnimation } from '../fx/hydration'
import { useI18n } from '../i18n/context'
import type { ServerItem } from '../lib/api/entities'
import { loadRankings, RANK_SIZE } from '../lib/api/loaders'
import { categoryOf, compactNumber, serverCategories, type Category } from '../lib/categories'
import { developerOf } from '../lib/entity'
import { absoluteUrl } from '../lib/seo'
import type { Route } from './+types/Rankings'

export const loader = (args: Route.LoaderArgs) => loadRankings(args)

/** 分类筛选只改查询参数，榜单数据不变，不用重新跑 loader */
export const shouldRevalidate = ({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs) => currentUrl.pathname !== nextUrl.pathname

const PATH = '/rankings'
const GROUP = 10
const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (n: number) => n.toLocaleString('en-US')
/** 奖牌色：金色随主题（浅色下压暗），银、铜固定 */
const MEDAL = ['var(--color-gold)', '#A7B0BC', '#C98B5E'] as const
const RULE_ICONS: Icon[] = [SortDescending, ClockCounterClockwise, ShieldCheck]

type Ranked = { r: ServerItem; rank: number; cat: Category }

/** 名次：前十名用正文色，其余用次要色 */
const Rank = ({ n, className }: { n: number; className?: string }) => (
  <span className={clsx('shrink-0 font-mono font-medium tabular-nums', n <= 10 ? 'text-ink' : 'text-text3', className)}>{pad(n)}</span>
)

const CatChip = ({ cat, className }: { cat: Category; className?: string }) => {
  const { tr } = useI18n()
  return (
    <span className={clsx('inline-flex h-[22px] items-center whitespace-nowrap rounded-md border px-2 text-[11px]', className)} style={{ color: cat.color, borderColor: `${cat.color}33`, background: `${cat.color}1A` }}>
      {tr(cat.name)}
    </span>
  )
}

/** 前三甲：第一名居中抬高，三张卡各用自己的奖牌色描边与光晕 */
function Podium({ top }: { top: Ranked[] }) {
  const { m, to } = useI18n()
  const t = m.rankings
  const icons = [Crown, Medal, Medal]
  return (
    <section className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">{t.podium.title}</h2>
          <p className="mt-1 text-[13px] text-text3">{t.podium.sub}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3 md:items-end">
        {top.map(({ r, rank, cat }, i) => {
          const first = i === 0
          const color = MEDAL[i]!
          const MedalIcon = icons[i]!
          return (
            <Link
              key={r.slug}
              to={to(`/servers/${r.slug}`)}
              className={clsx('group relative flex flex-col gap-[18px] rounded-[20px] border p-7 transition-transform duration-300 hover:-translate-y-1', first ? 'order-first gap-[22px] py-9 md:order-2 md:px-9' : i === 1 ? 'md:order-1' : 'md:order-3')}
              style={{
                borderColor: `color-mix(in srgb, ${color} ${first ? 40 : 22}%, transparent)`,
                background: `radial-gradient(140% 110% at 50% 0%, color-mix(in srgb, ${color} ${first ? 19 : 11}%, transparent), transparent 60%), var(--color-surface)`,
                boxShadow: first ? `0 24px 60px -24px color-mix(in srgb, ${color} 35%, transparent)` : undefined,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className={clsx('font-mono font-semibold leading-none tabular-nums tracking-[-0.04em]', first ? 'text-[56px]' : 'text-[44px]')} style={{ color }}>{pad(rank)}</span>
                  <span className="font-mono text-[10px] tracking-[0.22em]" style={{ color: `color-mix(in srgb, ${color} 70%, transparent)` }}>{t.podium.medals[i]}</span>
                </div>
                <span className={clsx('grid place-items-center rounded-full border', first ? 'size-11' : 'size-9')} style={{ color, borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` }}>
                  <MedalIcon size={first ? 22 : 18} />
                </span>
              </div>
              <div className="flex items-center gap-3.5">
                <EntityIcon name={r.name} src={r.iconUrl} color={cat.color} size={first ? 56 : 48} />
                <div className="min-w-0 flex-1">
                  <div className={clsx('truncate font-bold tracking-[-0.01em]', first ? 'text-[22px]' : 'text-lg')}>{r.name}</div>
                  <div className="truncate font-mono text-xs text-text3">{developerOf(r)}</div>
                </div>
              </div>
              <p className="line-clamp-2 min-h-[40px] text-[13px] leading-[1.55] text-text2">{r.tagline}</p>
              <div className="h-px bg-fg/[0.06]" />
              <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-text3">{t.podium.stars}</span>
                  <span className="flex items-center gap-1.5">
                    <Star size={16} weight="fill" style={{ color }} />
                    <span className={clsx('font-mono font-semibold leading-none tabular-nums tracking-[-0.03em]', first ? 'text-[30px]' : 'text-2xl')}>{r.stars !== null && <CountUp value={r.stars} format={(v) => compactNumber(Math.round(v))} />}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CatChip cat={cat} />
                  {r.toolsCount > 0 && <span className="inline-flex h-[22px] items-center rounded-md border border-fg/[0.08] bg-fg/[0.04] px-2 text-[11px] text-text2">{t.tools(r.toolsCount)}</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/** 榜单行：名次、图标、名称与简介、分类、工具数、星数占榜首的比例条、星数 */
function Row({ item, max }: { item: Ranked; max: number }) {
  const { m, to } = useI18n()
  const { r, rank, cat } = item
  const ratio = r.stars !== null && max > 0 ? Math.max(0.03, r.stars / max) : 0
  return (
    <li>
      <Link to={to(`/servers/${r.slug}`)} className="flex items-center gap-3.5 rounded-xl px-3.5 py-[11px] transition-colors hover:bg-fg/[0.05]">
        <Rank n={rank} className="w-[30px] text-[15px]" />
        <EntityIcon name={r.name} src={r.iconUrl} color={cat.color} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold">{r.name}</span>
            <span className="hidden truncate font-mono text-xs text-text3 sm:inline">{developerOf(r)}</span>
          </div>
          <div className="truncate text-[13px] text-text2">{r.tagline}</div>
        </div>
        <CatChip cat={cat} className="hidden w-24 justify-center md:inline-flex" />
        <span className="hidden w-[62px] shrink-0 text-right font-mono text-[11px] tabular-nums text-text3 lg:block">{r.toolsCount > 0 ? m.rankings.tools(r.toolsCount) : '—'}</span>
        <span className="hidden h-1 w-24 shrink-0 overflow-hidden rounded-full bg-fg/[0.08] sm:block" aria-hidden>
          <span className={clsx('block h-full rounded-full', rank <= 10 ? 'bg-gold' : 'bg-accent')} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
        <span className="flex w-[72px] shrink-0 items-center justify-end gap-1.5 font-mono text-sm font-medium tabular-nums">
          <Star size={13} className="text-text3" />
          {r.stars !== null ? compactNumber(r.stars) : '—'}
        </span>
      </Link>
    </li>
  )
}

/** 分类筛选：常见的几个分类平铺，其余收进"更多"下拉 */
function CategoryFilter({ counts, value, onChange }: { counts: Map<string, number>; value: string | null; onChange: (slug: string | null) => void }) {
  const { m, tr } = useI18n()
  const t = m.rankings
  const [open, setOpen] = useState(false)
  const ordered = serverCategories.filter((c) => (counts.get(c.slug) ?? 0) > 0).sort((a, b) => (counts.get(b.slug) ?? 0) - (counts.get(a.slug) ?? 0))
  const shown = ordered.slice(0, 5)
  const rest = ordered.slice(5)
  const inRest = rest.find((c) => c.slug === value)
  const btn = (active: boolean) => clsx('relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors', active ? 'font-semibold text-ink' : 'text-text2 hover:text-ink')
  const item = (key: string, label: string, n: number, active: boolean, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={active} className={btn(active)}>
      {active && <motion.span layoutId="rank-cat" className="absolute inset-0 rounded-lg bg-fg/10" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
      <span className="relative">{label}</span>
      <span className="relative font-mono text-[11px] tabular-nums text-text3">{n}</span>
    </button>
  )
  return (
    <nav aria-label={t.filterLabel} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-subtle p-[3px] [scrollbar-width:none]">
      {item('all', t.all, RANK_SIZE, value === null, () => onChange(null))}
      {shown.map((c) => item(c.slug, tr(c.name), counts.get(c.slug) ?? 0, value === c.slug, () => onChange(c.slug)))}
      {rest.length > 0 && (
        <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
          <DropdownMenu.Trigger className={clsx(btn(!!inRest), 'outline-none')}>
            {inRest && <span className="absolute inset-0 rounded-lg bg-fg/10" />}
            <span className="relative">{inRest ? tr(inRest.name) : t.more}</span>
            <CaretDown size={12} className={clsx('relative text-text3 transition-transform', open && 'rotate-180')} />
          </DropdownMenu.Trigger>
          <AnimatePresence>
            {open && (
              <DropdownMenu.Portal forceMount>
                <DropdownMenu.Content asChild align="end" sideOffset={8}>
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                    className="z-50 w-[220px] rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl"
                  >
                    {rest.map((c) => (
                      <DropdownMenu.Item key={c.slug} onSelect={() => onChange(c.slug)} className={clsx('flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-fg/[0.07]', c.slug === value ? 'text-ink' : 'text-text2')}>
                        <c.icon size={15} style={{ color: c.color }} />
                        <span className="flex-1 truncate">{tr(c.name)}</span>
                        <span className="font-mono text-[11px] tabular-nums text-text3">{counts.get(c.slug)}</span>
                        {c.slug === value && <Check size={14} className="text-accent" />}
                      </DropdownMenu.Item>
                    ))}
                  </motion.div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            )}
          </AnimatePresence>
        </DropdownMenu.Root>
      )}
    </nav>
  )
}

function SideCard({ title, sub, children, className }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('flex flex-col gap-3.5 rounded-2xl border border-fg/[0.08] bg-surface p-5', className)}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-text3">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

/** 分享：复制当前页面地址 */
function ShareButton({ url }: { url: string }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}
      className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] border border-fg/10 bg-fg/[0.04] px-3.5 text-[13px] transition-colors hover:border-fg/25 hover:bg-fg/[0.06]"
    >
      {copied ? <Check size={14} className="text-accent" /> : <ShareNetwork size={14} className="text-text2" />}
      {copied ? m.rankings.copied : m.rankings.share}
    </button>
  )
}

/** MCP 服务排行榜：按星数取前 100；分类筛选在 URL 里，关键词只在本地过滤 */
export default function Rankings({ loaderData }: Route.ComponentProps) {
  const { m, tr, to, locale } = useI18n()
  const t = m.rankings
  const enter = useEnterAnimation()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const category = params.get('category')
  const setCategory = (slug: string | null) => setParams(slug ? { category: slug } : {}, { replace: true, preventScrollReset: true })

  const all = useMemo<Ranked[]>(() => loaderData.rows.map((r, i) => ({ r, rank: i + 1, cat: categoryOf('server', r.category?.slug) })), [loaderData.rows])
  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const { cat } of all) c.set(cat.slug, (c.get(cat.slug) ?? 0) + 1)
    return c
  }, [all])
  const max = all[0]?.r.stars ?? 0
  const combined = all.reduce((s, { r }) => s + (r.stars ?? 0), 0)
  const updatedAt = all.reduce<string | null>((d, { r }) => (r.sourceUpdatedAt && (!d || r.sourceUpdatedAt > d) ? r.sourceUpdatedAt : d), null)?.slice(0, 10) ?? null

  const filtering = category !== null || q !== ''
  const kw = q.trim().toLowerCase()
  const shown = filtering ? all.filter(({ r, cat }) => (!category || cat.slug === category) && (!kw || `${r.name} ${developerOf(r) ?? ''} ${r.tagline ?? ''}`.toLowerCase().includes(kw))) : all.slice(3)
  const groups: { start: number; items: Ranked[] }[] = []
  for (const it of shown) {
    const start = Math.floor((it.rank - 1) / GROUP) * GROUP + 1
    const g = groups.at(-1)
    if (g && g.start === start) g.items.push(it)
    else groups.push({ start, items: [it] })
  }

  const dist = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const distTop = dist.slice(0, 5)
  const distOther = dist.slice(5).reduce((s, [, n]) => s + n, 0)
  const distMax = distTop[0]?.[1] ?? 1

  const url = absoluteUrl(locale, PATH)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t.title,
    url,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: all.length,
    itemListElement: all.map(({ r, rank }) => ({ '@type': 'ListItem', position: rank, name: r.name, url: absoluteUrl(locale, `/servers/${r.slug}`) })),
  }
  const stats = [
    [`TOP ${all.length}`, t.stats.top, true],
    [loaderData.total !== null ? fmt(loaderData.total) : null, t.stats.total, false],
    [compactNumber(combined), t.stats.stars, false],
    [max > 0 ? compactNumber(max) : null, t.stats.first, false],
    [updatedAt?.slice(5) ?? null, t.stats.updated, false],
  ] as const

  return (
    <>
      <Seo title={t.seoTitle} description={t.seoDesc(loaderData.total !== null ? fmt(loaderData.total) : fmt(all.length))} path={PATH} noindex={category !== null} jsonLd={jsonLd} />
      <section className="relative overflow-hidden border-b border-fg/[0.04]" style={{ background: 'radial-gradient(45% 160% at 50% 0%, color-mix(in srgb, var(--color-gold) 12%, transparent), transparent 60%), radial-gradient(30% 140% at 12% 20%, #2B7FFF17, transparent 60%)' }}>
        <motion.div
          initial={enter ? { opacity: 0, y: 14 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto flex max-w-[1248px] flex-col items-center gap-5 px-6 pb-14 pt-16 text-center"
        >
          <div className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.22em] text-gold">
            <span className="h-px w-7 bg-gold/40" />{t.eyebrow}<span className="h-px w-7 bg-gold/40" />
          </div>
          <h1 className="text-[40px] font-bold leading-[1.1] tracking-[-0.03em] md:text-[56px]">{t.title}</h1>
          <p className="max-w-[640px] text-[15px] leading-relaxed text-text2">{t.sub}</p>
          <dl className="mt-5 flex flex-wrap items-center justify-center gap-y-5">
            {stats.map(([v, label, hi], i) =>
              v === null ? null : (
                <div key={label} className={clsx('flex flex-col items-center gap-1.5 px-6 sm:px-9', i > 0 && 'sm:border-l sm:border-fg/[0.08]')}>
                  <dd className={clsx('font-mono text-2xl font-semibold tabular-nums tracking-[-0.02em]', hi ? 'text-gold' : 'text-ink')}>{v}</dd>
                  <dt className="text-xs text-text3">{label}</dt>
                </div>
              ),
            )}
          </dl>
        </motion.div>
      </section>

      <div className="mx-auto flex max-w-[1248px] flex-col gap-10 px-6 pb-24 pt-10">
        {!filtering && all.length >= 3 && <Podium top={all.slice(0, 3)} />}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CategoryFilter counts={counts} value={category} onChange={setCategory} />
            <div className="flex items-center gap-2.5">
              <div className="w-full sm:w-[240px]"><SearchBox q={q} placeholder={t.searchPh} onQuery={setQ} /></div>
              <ShareButton url={url} />
            </div>
          </div>
          {filtering && (
            <div className="flex items-center gap-2 text-[13px] text-text3">
              {t.filtered(shown.length)}
              <button type="button" onClick={() => { setQ(''); setCategory(null) }} className="flex h-6 items-center gap-1 rounded-md border border-fg/10 px-2 text-text2 transition-colors hover:border-fg/25 hover:text-ink">
                {t.empty.clear}<X size={11} />
              </button>
            </div>
          )}

          <div className="grid items-start gap-8 lg:grid-cols-[1fr_280px]">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-fg/[0.08] px-2.5 py-2" style={{ background: 'radial-gradient(110% 60% at 100% 0%, #2B7FFF1A, transparent 60%), var(--color-surface)' }}>
              {shown.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
                  <Trophy size={28} className="text-text3" />
                  <h2 className="text-lg font-semibold">{t.empty.title(q.trim() || (category ? tr(categoryOf('server', category).name) : ''))}</h2>
                  <p className="text-sm text-text2">{t.empty.hint}</p>
                  <button type="button" onClick={() => { setQ(''); setCategory(null) }} className="mt-1 flex h-[38px] items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">{t.empty.clear}</button>
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.start} id={`rank-${g.start}`} className="scroll-mt-[calc(var(--nav-h,110px)+12px)]">
                    <h2 className="flex items-center gap-3 px-2.5 pb-2 pt-3.5 font-mono text-[11px] tracking-[0.14em] text-text3">
                      {pad(g.items[0]!.rank)} — {pad(g.start + GROUP - 1)}
                      <span className="h-px flex-1 bg-fg/[0.06]" />
                    </h2>
                    <ul>{g.items.map((it) => <Row key={it.r.slug} item={it} max={max} />)}</ul>
                  </section>
                ))
              )}
              {shown.length > 0 && !filtering && (
                <div className="flex flex-col items-center gap-2.5 px-6 pb-5 pt-7">
                  <span className="text-[13px] text-text3">{t.end.text}</span>
                  <Link to={to('/servers')} className="flex h-10 items-center gap-2 rounded-[10px] border border-fg/15 bg-fg/[0.03] px-[18px] text-[13px] font-medium transition-colors hover:border-fg/30 hover:bg-fg/[0.06]">
                    {t.end.link}<ArrowRight size={14} className="text-text2" />
                  </Link>
                </div>
              )}
            </div>

            <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--nav-h,110px)+16px)]">
              <SideCard title={t.side.dist.title} sub={t.side.dist.sub}>
                <ul className="flex flex-col gap-2.5">
                  {[...distTop, ...(distOther > 0 ? [['other', distOther] as const] : [])].map(([slug, n]) => {
                    const cat = categoryOf('server', slug)
                    const isOther = slug === 'other' && !counts.has('other')
                    return (
                      <li key={slug}>
                        <button type="button" disabled={isOther} onClick={() => setCategory(slug)} className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-default">
                          <span className="flex items-center justify-between text-xs">
                            <span className={clsx('text-text2 transition-colors', !isOther && 'group-hover:text-ink')}>{isOther ? t.side.dist.other : tr(cat.name)}</span>
                            <span className="font-mono tabular-nums text-ink">{n}</span>
                          </span>
                          <span className="block h-1 overflow-hidden rounded-full bg-fg/[0.07]"><span className="block h-full rounded-full" style={{ width: `${Math.round((n / distMax) * 100)}%`, background: isOther ? 'var(--color-text3)' : cat.color }} /></span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </SideCard>
              {!filtering && (
                <SideCard title={t.side.jump}>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: all.length / GROUP }, (_, k) => (
                      <a key={k} href={`#rank-${k * GROUP + 1}`} className="flex h-[30px] items-center justify-center rounded-[7px] border border-fg/[0.08] bg-fg/[0.03] font-mono text-[11px] tabular-nums text-text2 transition-colors hover:border-gold/40 hover:text-gold">
                        {k * GROUP + 1}–{(k + 1) * GROUP}
                      </a>
                    ))}
                  </div>
                </SideCard>
              )}
              <SideCard title={t.side.rules.title}>
                <ul className="flex flex-col gap-3">
                  {t.side.rules.items.map(([title, body], i) => {
                    const RuleIcon = RULE_ICONS[i] ?? SortDescending
                    return (
                      <li key={title} className="flex gap-2.5">
                        <RuleIcon size={15} className="mt-px shrink-0 text-accent" />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold">{title}</span>
                          <span className="text-xs leading-[1.5] text-text3">{body}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </SideCard>
              <section className="flex flex-col gap-2.5 rounded-2xl border border-gold/20 p-5" style={{ background: 'radial-gradient(160% 140% at 0% 0%, color-mix(in srgb, var(--color-gold) 14%, transparent), transparent 60%), var(--color-surface)' }}>
                <Trophy size={22} className="text-gold" />
                <h3 className="text-sm font-semibold">{t.side.claim.title}</h3>
                <p className="text-xs leading-[1.5] text-text3">{t.side.claim.text}</p>
                <a href="mailto:hello@mcpfield.dev" className="mt-1 flex h-[34px] w-fit items-center gap-1.5 rounded-full bg-gold px-3.5 text-xs font-semibold text-[#1A1400] transition-opacity hover:opacity-90">
                  {t.side.claim.btn}<ArrowRight size={12} />
                </a>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </>
  )
}
