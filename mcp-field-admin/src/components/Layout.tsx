import { ArrowsClockwise, CalendarCheck, Database, MagicWand, Notebook, SignOut, SquaresFour, TerminalWindow, UserGear } from '@phosphor-icons/react'
import clsx from 'clsx'
import { createContext, useContext, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useApi, type AdminUser, type Dashboard } from '../lib/api'
import { compact, todayBeijing, weekday } from '../lib/format'
import { KIND_LABEL, KINDS } from '../lib/labels'

/* 后台框架：左侧导航（带今日异常角标、各类型条目数）+ 顶栏 + 页面 */

interface Shell {
  user: AdminUser
  logout: () => void
  /** 侧栏数据（来自仪表盘接口），各页面改动后可以刷新 */
  summary?: Dashboard
}

const ShellContext = createContext<Shell | null>(null)
export const useShell = () => useContext(ShellContext)!

const NAV = [
  { to: '/', label: '仪表盘', icon: SquaresFour, end: true },
  { to: '/daily', label: '每日采集', icon: CalendarCheck },
  { to: '/items', label: '数据管理', icon: Database },
  { to: '/blog', label: '博客文章', icon: Notebook },
  { to: '/logs', label: '运行日志', icon: TerminalWindow },
  { to: '/settings', label: 'AI 设置', icon: MagicWand },
  { to: '/account', label: '账号设置', icon: UserGear },
]

export function Layout({ user, logout }: { user: AdminUser; logout: () => void }) {
  const { data: summary } = useApi<Dashboard>('/dashboard', 60_000)
  const location = useLocation()
  const kindParam = new URLSearchParams(location.search).get('kind')
  const failedSteps = summary?.batch?.steps.filter((s) => s.status === 'failed' || s.status === 'interrupted').length ?? 0

  return (
    <ShellContext.Provider value={{ user, logout, summary }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-58 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3.5 py-5">
          <Link to="/" className="flex items-center gap-2.5 px-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-linear-135 from-[#3ddc97] to-[#2b7fff] text-[13px] font-bold text-[#06110d]">MF</span>
            <span>
              <span className="block text-[15px] font-semibold leading-tight">MCP Field</span>
              <span className="block text-[11px] text-text3">管理后台</span>
            </span>
          </Link>
          <nav className="flex flex-col gap-0.5">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => clsx('flex h-9.5 items-center gap-2.5 rounded-lg px-2.5 text-sm', isActive ? 'bg-white/[0.06] font-semibold text-ink' : 'text-text2 hover:bg-white/[0.03] hover:text-ink')}
              >
                <Icon className="size-[18px]" />
                <span className="flex-1">{label}</span>
                {to === '/daily' && failedSteps > 0 && <span className="rounded-full bg-err px-1.5 font-mono text-[11px] font-semibold text-white">{failedSteps}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-[11px] tracking-wide text-text3">按类型浏览</p>
            {KINDS.map((k) => (
              <Link
                key={k}
                to={`/items?kind=${k}`}
                className={clsx('flex h-7.5 items-center justify-between rounded-md px-2.5 text-[13px]', location.pathname === '/items' && kindParam === k ? 'bg-white/[0.05] font-semibold text-ink' : 'text-text2 hover:text-ink')}
              >
                {KIND_LABEL[k]}
                <span className="font-mono text-xs text-text3">{summary ? compact(summary.totals[k]) : ''}</span>
              </Link>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2.5 border-t border-line px-2 pt-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{user.username}</span>
              <span className="block text-[11px] text-text3">管理员</span>
            </span>
            <button onClick={logout} title="退出登录" className="rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink">
              <SignOut className="size-[18px]" />
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  )
}

/** 页面顶栏：标题、副标题、右侧操作 */
export function PageHeader({ title, sub, actions, onRefresh }: { title: string; sub?: ReactNode; actions?: ReactNode; onRefresh?: () => void }) {
  const today = todayBeijing()
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-line bg-bg/90 px-8 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="truncate text-[13px] text-text3">{sub ?? `${today} ${weekday(today)} · 北京时间`}</span>
      </div>
      <div className="flex items-center gap-2.5">
        {actions}
        {onRefresh && (
          <button onClick={onRefresh} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] text-text2 hover:bg-white/5 hover:text-ink">
            <ArrowsClockwise className="size-[15px]" />
            刷新
          </button>
        )}
      </div>
    </header>
  )
}
