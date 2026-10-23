import {
  ArrowLeft,
  ArrowUpRight,
  BookmarkSimple,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CloudArrowUp,
  Compass,
  DownloadSimple,
  Lightning,
  MagnifyingGlass,
  PlugsConnected,
  SignOut,
  SortDescending,
  Star,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { data, Link, useNavigate } from 'react-router'
import * as Menu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import { EntityIcon } from '../components/EntityIcon'
import { FavoriteToastHost } from '../components/FavoriteToast'
import { BrandMark, Wordmark } from '../components/Logo'
import { Seo } from '../components/Seo'
import { I18nProvider, useI18n } from '../i18n/context'
import { DEFAULT_LOCALE, localeFromParam } from '../i18n/locales'
import { ROUTE, type SkillItem } from '../lib/api/entities'
import { profile, supabase, useSession } from '../lib/auth'
import { categoryOf, compactNumber } from '../lib/categories'
import { developerOf, domainOf } from '../lib/entity'
import { fetchFavorites, setFavorite, showToast, type Favorite } from '../lib/favorites'
import type { Route } from './+types/Console'

/*
 * 控制台（/console）：登录用户自己的页面，不带站点导航和页脚，不让搜索引擎收录。
 * 第一版只有「我的收藏」：列出在详情页收藏的 MCP 服务和 Skill，可按类型切换、搜索、排序，可取消收藏（轻提示里可撤销）。
 * 以后的云端托管（部署、统一接入地址、调用日志）加在侧栏里。
 * 收藏一次全部取回（每人最多 1000 条），筛选、排序、分页都在浏览器里做；未登录时去登录页，登录后回到这里。
 */

export function loader({ params }: Route.LoaderArgs) {
  if (!localeFromParam(params.lang)) throw data(null, { status: 404 })
  return null
}

export default function Console({ params }: Route.ComponentProps) {
  return (
    <I18nProvider locale={localeFromParam(params.lang) ?? DEFAULT_LOCALE}>
      <ConsolePage />
    </I18nProvider>
  )
}

type Tab = 'all' | 'server' | 'skill'
type Sort = 'recent' | 'name' | 'hot'
const SORTS: Sort[] = ['recent', 'name', 'hot']
const PAGE_SIZE = 20

/** 热度：MCP 服务看 GitHub 星数，Skill 看安装量；已下架的排最后 */
const hotOf = (f: Favorite) => (f.item ? ((f.kind === 'skill' ? (f.item as SkillItem).installs : f.item.stars) ?? 0) : -1)
const ownerOf = (f: Favorite) => (f.item ? (developerOf(f.item) ?? domainOf(f.item)) : null)

function ConsolePage() {
  const { m, to, locale } = useI18n()
  const t = m.console
  const navigate = useNavigate()
  const { user, pending } = useSession()
  const [list, setList] = useState<Favorite[] | null>(null)
  /** 列表取回的时间：收藏时间按它显示成"今天""3 天前" */
  const [now, setNow] = useState(0)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [page, setPage] = useState(1)

  // 没登录：去登录页，登录后回到控制台。只跳一次：to、navigate 在导航过程中会换成新的函数，依赖它们会反复跳转
  const loginHref = `${to('/login')}?redirect=${encodeURIComponent(to('/console'))}`
  const redirected = useRef(false)
  useEffect(() => {
    if (pending || user || redirected.current) return
    redirected.current = true
    navigate(loginHref, { replace: true })
  }, [pending, user, loginHref, navigate])

  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    const ctrl = new AbortController()
    fetchFavorites(locale, ctrl.signal).then(
      (rows) => {
        setList(rows)
        setNow(Date.now())
        setFailed(false)
      },
      () => ctrl.signal.aborted || setFailed(true),
    )
    return () => ctrl.abort()
  }, [userId, locale, nonce])

  // 换类型、搜索词、排序时回到第一页
  const filter = <V,>(set: (v: V) => void) => (v: V) => {
    set(v)
    setPage(1)
  }

  const counts = useMemo(() => ({ all: list?.length ?? 0, server: list?.filter((f) => f.kind === 'server').length ?? 0, skill: list?.filter((f) => f.kind === 'skill').length ?? 0 }), [list])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = (list ?? []).filter(
      (f) => (tab === 'all' || f.kind === tab) && (!needle || [f.name, f.slug, ownerOf(f) ?? '', f.item?.author?.login ?? ''].some((s) => s.toLowerCase().includes(needle))),
    )
    const byRecent = (a: Favorite, b: Favorite) => b.favoritedAt.localeCompare(a.favoritedAt)
    return rows.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, locale) : sort === 'hot' ? (a, b) => hotOf(b) - hotOf(a) || byRecent(a, b) : byRecent)
  }, [list, tab, q, sort, locale])

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const f = m.detail.favorite
  const drop = (x: Favorite) => setList((l) => l?.filter((y) => !(y.kind === x.kind && y.slug === x.slug)) ?? l)
  const put = (x: Favorite) => setList((l) => (l ? [...l.filter((y) => !(y.kind === x.kind && y.slug === x.slug)), x] : l))

  const remove = async (x: Favorite) => {
    drop(x)
    try {
      await setFavorite(x.kind, x.slug, false)
      showToast({ tone: 'removed', title: f.removed, desc: f.removedHint(x.name), action: { label: f.undo, run: () => void restore(x) } })
    } catch {
      put(x)
      showToast({ tone: 'failed', title: f.failed, desc: f.failedHint, action: { label: f.retry, run: () => void remove(x) } })
    }
  }

  // 撤销：按原来的收藏时间重新收藏
  const restore = async (x: Favorite) => {
    put(x)
    try {
      await setFavorite(x.kind, x.slug, true, x.favoritedAt)
    } catch {
      drop(x)
      showToast({ tone: 'failed', title: f.failed, desc: f.failedHint, action: { label: f.retry, run: () => void restore(x) } })
    }
  }

  const ready = !!user && list !== null
  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <Seo title={t.title} path="/console" noindex />
      <Sidebar count={ready ? counts.all : null} />
      <main className="flex min-w-0 flex-1 flex-col">
        <MobileBar />
        <header className="flex h-16 items-center justify-between gap-4 border-b border-fg/[0.08] px-5 sm:px-8">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="whitespace-nowrap text-lg font-semibold">{t.heading}</h1>
            <p className="hidden truncate text-sm text-text3 sm:block">{t.sub}</p>
          </div>
          <Link to={to('/')} className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-fg/[0.12] bg-fg/[0.04] px-3 text-sm transition-colors hover:border-fg/25 hover:bg-fg/[0.07]">
            <Compass size={15} className="text-text2" />
            {t.explore}
          </Link>
        </header>

        <div className="flex flex-1 flex-col gap-4 px-5 py-6 sm:px-8">
          {failed ? (
            <Notice title={t.error} action={<button type="button" onClick={() => {
                  setFailed(false)
                  setNonce((n) => n + 1)
                }} className="h-9 rounded-full border border-fg/[0.12] px-4 text-sm hover:border-fg/25">{t.retry}</button>} />
          ) : ready && list.length === 0 ? (
            <Empty />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <div role="tablist" className="flex h-9 items-center gap-0.5 rounded-[10px] border border-fg/[0.08] bg-fg/[0.03] p-[3px]">
                  {(['all', 'server', 'skill'] as Tab[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => filter(setTab)(key)}
                      className={clsx('flex h-full items-center gap-1.5 rounded-[7px] px-3 text-sm transition-colors', tab === key ? 'bg-fg/[0.09] font-semibold text-ink' : 'text-text2 hover:text-ink')}
                    >
                      {t.tabs[key]}
                      <span className={clsx('font-mono text-[11px]', tab === key ? 'text-text2' : 'text-text3')}>{ready ? counts[key] : '–'}</span>
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <label className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-fg/[0.08] bg-fg/[0.03] px-3 focus-within:border-fg/25 sm:w-[280px]">
                  <MagnifyingGlass size={15} className="shrink-0 text-text3" />
                  <input value={q} onChange={(e) => filter(setQ)(e.target.value)} placeholder={t.search} aria-label={t.search} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text3" />
                </label>
                <SortMenu value={sort} onChange={filter(setSort)} />
              </div>

              <div className="overflow-hidden rounded-xl border border-fg/[0.08] bg-surface">
                <div className="hidden h-10 items-center border-b border-fg/[0.08] bg-fg/[0.02] px-5 text-xs text-text3 md:flex">
                  <span className="flex-1">{t.cols.name}</span>
                  <span className="w-[110px]">{t.cols.type}</span>
                  <span className="hidden w-[150px] lg:block">{t.cols.category}</span>
                  <span className="w-[100px]">{t.cols.hot}</span>
                  <span className="w-[110px]">{t.cols.favoritedAt}</span>
                  <span className="w-[72px] text-right">{t.cols.actions}</span>
                </div>
                {!ready ? (
                  Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="flex h-16 items-center gap-3 border-b border-fg/[0.06] px-5 last:border-0">
                      <div className="size-9 animate-pulse rounded-[9px] bg-fg/[0.06]" />
                      <div className="h-3.5 w-40 animate-pulse rounded bg-fg/[0.06]" />
                    </div>
                  ))
                ) : pageRows.length === 0 ? (
                  <p className="px-5 py-12 text-center text-sm text-text3">{t.noMatch}</p>
                ) : (
                  // 换类型、搜索、排序、翻页时整组换掉，只有取消收藏的那一行播放淡出
                  <AnimatePresence key={`${tab}|${q}|${sort}|${current}`} initial={false}>
                    {pageRows.map((x) => (
                      <Row key={`${x.kind}:${x.slug}`} f={x} now={now} onRemove={() => void remove(x)} />
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {ready && shown.length > 0 && (
                <div className="flex items-center justify-between gap-4 px-1 text-sm text-text3">
                  <span>{t.range((current - 1) * PAGE_SIZE + 1, Math.min(current * PAGE_SIZE, shown.length), shown.length)}</span>
                  {pages > 1 && (
                    <div className="flex items-center gap-1.5">
                      <PageButton label={t.prev} disabled={current === 1} onClick={() => setPage(current - 1)}>
                        <CaretLeft size={13} />
                      </PageButton>
                      <span className="min-w-12 text-center font-mono text-xs text-text2">
                        {current} / {pages}
                      </span>
                      <PageButton label={t.next} disabled={current === pages} onClick={() => setPage(current + 1)}>
                        <CaretRight size={13} />
                      </PageButton>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <FavoriteToastHost />
    </div>
  )
}

function Row({ f, now, onRemove }: { f: Favorite; now: number; onRemove: () => void }) {
  const { m, to, tr } = useI18n()
  const t = m.console
  const item = f.item
  const cat = item ? categoryOf(f.kind, item.category?.slug) : null
  const href = to(`/${ROUTE[f.kind]}/${f.slug}`)
  const owner = ownerOf(f)
  const hot = item ? hotOf(f) : null
  const isServer = f.kind === 'server'
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="group flex min-h-16 items-center gap-3 border-b border-fg/[0.06] px-4 py-3 transition-colors last:border-0 hover:bg-fg/[0.03] sm:px-5 md:gap-0"
    >
      <div className={clsx('flex min-w-0 flex-1 items-center gap-3', !item && 'opacity-60')}>
        <EntityIcon name={f.name} src={item?.iconUrl ?? null} color={cat?.color ?? '#6B7280'} size={36} className="border border-fg/10" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {item ? (
              <a href={href} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold hover:underline">
                {f.name}
              </a>
            ) : (
              <span className="truncate text-sm font-semibold text-text3">{f.name}</span>
            )}
            {!item && <span className="shrink-0 rounded-full border border-fg/15 px-1.5 text-[11px] text-text3">{t.delisted}</span>}
          </div>
          <p className="truncate text-xs text-text3">
            {owner ?? f.slug}
            <span className="md:hidden"> · {t.kinds[f.kind]}</span>
          </p>
        </div>
      </div>
      <div className={clsx('hidden w-[110px] md:block', !item && 'opacity-50')}>
        <span className={clsx('rounded-full border px-2 py-0.5 text-[11px]', isServer ? 'border-accent/25 bg-accent/10 text-accent' : 'border-[#A78BFA]/30 bg-[#A78BFA]/10 text-violet')}>{t.kinds[f.kind]}</span>
      </div>
      <div className="hidden w-[150px] min-w-0 items-center gap-1.5 text-sm text-text2 lg:flex">
        {cat && item ? (
          <>
            <cat.icon size={14} className="shrink-0" style={{ color: cat.color }} />
            <span className="truncate">{tr(cat.name)}</span>
          </>
        ) : (
          <span className="text-text3">—</span>
        )}
      </div>
      <div className="hidden w-[100px] items-center gap-1 font-mono text-[13px] text-text2 md:flex">
        {hot === null ? (
          <span className="text-text3">—</span>
        ) : (
          <>
            {isServer ? <Star size={13} weight="fill" className="text-gold" /> : <DownloadSimple size={13} className="text-text3" />}
            {compactNumber(hot)}
          </>
        )}
      </div>
      <div className="hidden w-[110px] font-mono text-xs text-text2 md:block">
        <When iso={f.favoritedAt} now={now} />
      </div>
      <div className="flex w-[72px] shrink-0 items-center justify-end gap-1">
        {item && (
          <a href={href} target="_blank" rel="noreferrer" title={t.open} aria-label={t.open} className="grid size-[30px] place-items-center rounded-lg text-text3 transition-colors hover:bg-fg/[0.07] hover:text-ink">
            <ArrowUpRight size={15} />
          </a>
        )}
        <button type="button" onClick={onRemove} title={t.remove} aria-label={t.remove} className="grid size-[30px] place-items-center rounded-lg text-gold transition-colors hover:bg-[#F2C94C]/10">
          <BookmarkSimple size={16} weight="fill" />
        </button>
      </div>
    </motion.div>
  )
}

/** 收藏时间：今天显示时分，昨天、一周内显示相对时间，更早显示月-日（不是今年的带上年份）；只在浏览器里渲染 */
function When({ iso, now: nowMs }: { iso: string; now: number }) {
  const { m } = useI18n()
  const t = m.console
  const at = new Date(iso)
  const now = new Date(nowMs)
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days <= 0) return <>{`${t.today} ${pad(at.getHours())}:${pad(at.getMinutes())}`}</>
  if (days === 1) return <>{t.yesterday}</>
  if (days < 7) return <>{t.daysAgo(days)}</>
  const md = `${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return <>{at.getFullYear() === now.getFullYear() ? md : `${at.getFullYear()}-${md}`}</>
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  const { m } = useI18n()
  const t = m.console
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="flex h-9 items-center gap-1.5 rounded-[10px] border border-fg/[0.08] bg-fg/[0.03] px-3 text-sm outline-none transition-colors hover:border-fg/20 data-[state=open]:border-fg/30">
        <SortDescending size={15} className="text-text3" />
        <span className="text-text3">{t.sort}</span>
        <span className="whitespace-nowrap">{t.sorts[value]}</span>
        <CaretDown size={12} className="text-text3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[168px] rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {SORTS.map((key) => (
            <Menu.Item
              key={key}
              onSelect={() => onChange(key)}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm text-text2 outline-none data-[highlighted]:bg-fg/[0.07] data-[highlighted]:text-ink"
            >
              <span className="flex-1 whitespace-nowrap">{t.sorts[key]}</span>
              {value === key && <Check size={14} className="text-accent" />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

function PageButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid size-[30px] place-items-center rounded-lg border border-fg/[0.1] text-text2 transition-colors hover:border-fg/25 hover:text-ink disabled:opacity-40 disabled:hover:border-fg/[0.1]">
      {children}
    </button>
  )
}

function Notice({ title, action }: { title: string; action: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
      <p className="text-sm text-text2">{title}</p>
      {action}
    </div>
  )
}

function Empty() {
  const { m, to } = useI18n()
  const t = m.console.empty
  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
      <span className="grid size-16 place-items-center rounded-[18px] border border-[#F2C94C]/30 bg-[#F2C94C]/10 text-gold shadow-[0_12px_32px_rgba(242,201,76,0.12)]">
        <BookmarkSimple size={28} />
      </span>
      <h2 className="mt-5 text-xl font-semibold">{t.title}</h2>
      <p className="mt-2.5 max-w-[440px] text-balance text-sm leading-relaxed text-text2">{t.hint}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link to={to('/servers')} className="flex h-[38px] items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-110">
          <PlugsConnected size={15} weight="bold" />
          {t.servers}
        </Link>
        <Link to={to('/skills')} className="flex h-[38px] items-center gap-1.5 rounded-full border border-fg/[0.12] bg-fg/[0.04] px-4 text-sm transition-colors hover:border-fg/25">
          <Lightning size={15} className="text-text2" />
          {t.skills}
        </Link>
      </div>
    </div>
  )
}

/** 宽屏左侧栏：品牌、我的收藏、云端托管预告、返回网站、当前账号 */
function Sidebar({ count }: { count: number | null }) {
  const { m, to } = useI18n()
  const t = m.console
  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col gap-6 border-r border-fg/[0.08] bg-surface px-3.5 py-5 lg:flex">
      <Link to={to('/')} className="group flex items-center gap-2 px-2">
        <BrandMark className="size-8 overflow-visible" />
        <span className="flex flex-col leading-tight">
          <Wordmark className="text-base" />
          <span className="text-[11px] text-text3">{t.brand}</span>
        </span>
      </Link>
      <nav>
        <span aria-current="page" className="flex h-[38px] items-center gap-2.5 rounded-lg bg-fg/[0.06] px-2.5 text-sm font-semibold">
          <BookmarkSimple size={18} />
          <span className="flex-1">{t.heading}</span>
          {count !== null && <span className="font-mono text-xs font-normal text-text2">{count}</span>}
        </span>
      </nav>
      <div className="flex-1" />
      <div className="rounded-[10px] border border-accent/20 bg-gradient-to-b from-accent/[0.07] to-transparent p-3.5">
        <div className="flex items-center gap-2">
          <CloudArrowUp size={16} className="text-accent" />
          <span className="flex-1 text-sm font-semibold">{t.cloud.title}</span>
          <span className="rounded-full bg-fg/[0.06] px-1.5 py-px text-[10px] text-text2">{t.cloud.soon}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text3">{t.cloud.desc}</p>
      </div>
      <Link to={to('/')} className="-mt-2 flex h-[34px] items-center gap-2 px-2.5 text-sm text-text2 transition-colors hover:text-ink">
        <ArrowLeft size={15} className="text-text3" />
        {t.back}
      </Link>
      <Account />
    </aside>
  )
}

/** 窄屏顶栏：品牌、返回网站、退出 */
function MobileBar() {
  const { m, to } = useI18n()
  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-fg/[0.08] bg-surface px-5 lg:hidden">
      <Link to={to('/')} className="group flex items-center gap-2">
        <BrandMark className="size-7 overflow-visible" />
        <Wordmark className="text-base" />
        <span className="text-xs text-text3">· {m.console.brand}</span>
      </Link>
      <Link to={to('/')} className="flex items-center gap-1.5 text-sm text-text2">
        <ArrowLeft size={14} />
        {m.console.back}
      </Link>
    </div>
  )
}

function Account() {
  const { m, to } = useI18n()
  const navigate = useNavigate()
  const { user } = useSession()
  if (!user) return <div className="h-[46px] border-t border-fg/[0.08]" />
  const me = profile(user)
  return (
    <div className="flex items-center gap-2.5 border-t border-fg/[0.08] px-2 pt-3">
      {me.avatar ? (
        <img src={me.avatar} alt="" referrerPolicy="no-referrer" className="size-[30px] shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-blue text-[13px] font-semibold uppercase text-accent-ink">{(me.name || me.email).slice(0, 1)}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{me.name}</div>
        <div className="truncate text-[11px] text-text3">{me.email}</div>
      </div>
      <button
        type="button"
        title={m.nav.logout}
        aria-label={m.nav.logout}
        onClick={() => void supabase().auth.signOut().then(() => navigate(to('/')))}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-fg/[0.07] hover:text-ink"
      >
        <SignOut size={17} />
      </button>
    </div>
  )
}
