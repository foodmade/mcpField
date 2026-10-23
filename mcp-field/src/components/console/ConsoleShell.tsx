import { ArrowLeft, BookmarkSimple, CloudArrowUp, Key, SignOut, type Icon } from '@phosphor-icons/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import { useApiKeys } from '../../lib/apiKeys'
import { profile, supabase, useSession } from '../../lib/auth'
import { useFavorites } from '../../lib/favorites'
import { FavoriteToastHost } from '../FavoriteToast'
import { BrandMark, Wordmark } from '../Logo'

export type ConsoleSection = 'favorites' | 'keys'

const PATHS: Record<ConsoleSection, string> = { favorites: '/console', keys: '/console/keys' }

/**
 * 控制台页面的外壳：宽屏左侧栏（品牌、各栏目、云端托管预告、返回网站、当前账号），窄屏顶栏加栏目切换；
 * 右侧是页面标题、右上角操作和内容。没登录时去登录页，登录后回到当前栏目。
 */
export function ConsoleShell({ section, title, sub, action, children }: { section: ConsoleSection; title: string; sub: string; action?: ReactNode; children: ReactNode }) {
  const { to } = useI18n()
  const navigate = useNavigate()
  const { user, pending } = useSession()

  // 只跳一次：to、navigate 在导航过程中会换成新的函数，依赖它们会反复跳转
  const loginHref = `${to('/login')}?redirect=${encodeURIComponent(to(PATHS[section]))}`
  const redirected = useRef(false)
  useEffect(() => {
    if (pending || user || redirected.current) return
    redirected.current = true
    navigate(loginHref, { replace: true })
  }, [pending, user, loginHref, navigate])

  return (
    <div className="flex min-h-dvh bg-bg text-ink">
      <Sidebar section={section} />
      <main className="flex min-w-0 flex-1 flex-col">
        <MobileBar section={section} />
        <header className="flex h-16 items-center justify-between gap-4 border-b border-fg/[0.08] px-5 sm:px-8">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="whitespace-nowrap text-lg font-semibold">{title}</h1>
            <p className="hidden truncate text-sm text-text3 sm:block">{sub}</p>
          </div>
          {action}
        </header>
        <div className="flex flex-1 flex-col gap-4 px-5 py-6 sm:px-8">{children}</div>
      </main>
      <FavoriteToastHost />
    </div>
  )
}

/** 各栏目和侧栏上的数量：收藏数、有效密钥数（读到之前不显示） */
function useNav(): { key: ConsoleSection; icon: Icon; label: string; count: number | null }[] {
  const { m } = useI18n()
  const favorites = useFavorites()
  const keys = useApiKeys()
  return [
    { key: 'favorites', icon: BookmarkSimple, label: m.console.heading, count: favorites.ready ? favorites.keys.size : null },
    { key: 'keys', icon: Key, label: m.console.keys.heading, count: keys.list ? keys.list.filter((k) => !k.expired).length : null },
  ]
}

function Sidebar({ section }: { section: ConsoleSection }) {
  const { m, to } = useI18n()
  const t = m.console
  const nav = useNav()
  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col gap-6 border-r border-fg/[0.08] bg-surface px-3.5 py-5 lg:flex">
      <Link to={to('/')} className="group flex items-center gap-2 px-2">
        <BrandMark className="size-8 overflow-visible" />
        <span className="flex flex-col leading-tight">
          <Wordmark className="text-base" />
          <span className="text-[11px] text-text3">{t.brand}</span>
        </span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {nav.map(({ key, icon: I, label, count }) => (
          <Link
            key={key}
            to={to(PATHS[key])}
            aria-current={key === section ? 'page' : undefined}
            className={clsx('flex h-[38px] items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors', key === section ? 'bg-fg/[0.06] font-semibold' : 'text-text2 hover:bg-fg/[0.04] hover:text-ink')}
          >
            <I size={18} className={key === section ? '' : 'text-text3'} />
            <span className="flex-1">{label}</span>
            {count !== null && <span className={clsx('font-mono text-xs font-normal', key === section ? 'text-text2' : 'text-text3')}>{count}</span>}
          </Link>
        ))}
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

/** 窄屏顶栏：品牌、返回网站，下面一行切换栏目 */
function MobileBar({ section }: { section: ConsoleSection }) {
  const { m, to } = useI18n()
  const nav = useNav()
  return (
    <div className="border-b border-fg/[0.08] bg-surface lg:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-5">
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
      <nav className="flex gap-1 px-4 pb-2.5">
        {nav.map(({ key, icon: I, label, count }) => (
          <Link
            key={key}
            to={to(PATHS[key])}
            aria-current={key === section ? 'page' : undefined}
            className={clsx('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm', key === section ? 'bg-fg/[0.07] font-semibold' : 'text-text2')}
          >
            <I size={15} />
            {label}
            {count !== null && <span className="font-mono text-[11px] font-normal text-text3">{count}</span>}
          </Link>
        ))}
      </nav>
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
