import { motion, useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import {
  AppWindow, ArrowsClockwise, Compass, Globe, Lightning, MagnifyingGlass, Moon, PlugsConnected, Robot, Rss, Sun, TerminalWindow, type Icon,
} from '@phosphor-icons/react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import { stripLocale } from '../i18n/locales'
import { sharedStats, type SiteStats } from '../lib/api/home'
import { useApi } from '../lib/api/useApi'
import { compactNumber } from '../lib/categories'
import { setTheme, useTheme } from '../lib/theme'
import { AccountMenu } from './AccountMenu'
import { LanguageMenu } from './LanguageMenu'
import { LocaleBanner } from './LocaleBanner'
import { Logo } from './Logo'
import { SearchDialog, useCmdK } from './SearchDialog'

type TabKey = 'discover' | 'servers' | 'remote' | 'clients' | 'cli' | 'loops' | 'skills' | 'agents' | 'feed'
type Tab = { key: TabKey; icon: Icon; to?: string; count?: (s: SiteStats) => number }

/** 顶部栏目按用途分组：发现 | MCP（服务、远程、客户端）| Agent 工具 | 动态；没有 to 的栏目尚未上线 */
const NAV_GROUPS: Tab[][] = [
  [{ key: 'discover', to: '/', icon: Compass }],
  [
    { key: 'servers', to: '/servers', icon: PlugsConnected, count: (s) => s.totals.server },
    { key: 'remote', to: '/remote-servers', icon: Globe, count: (s) => s.remote },
    { key: 'clients', to: '/clients', icon: AppWindow, count: (s) => s.totals.client },
  ],
  [
    { key: 'skills', to: '/skills', icon: Lightning, count: (s) => s.totals.skill },
    { key: 'cli', to: '/cli', icon: TerminalWindow, count: (s) => s.totals.cli },
    { key: 'loops', to: '/loops', icon: ArrowsClockwise, count: (s) => s.totals.loop },
    { key: 'agents', to: '/agents', icon: Robot, count: (s) => s.totals.agent },
  ],
  [{ key: 'feed', icon: Rss }],
]

/** 明暗主题切换：深色时显示太阳（点了切到明亮），明亮时显示月亮 */
function ThemeToggle({ label }: { label: string }) {
  const theme = useTheme()
  return (
    <motion.button
      aria-label={label}
      title={label}
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      whileTap={{ rotate: -30 }}
      className="grid size-[34px] place-items-center rounded-lg text-text2 transition-colors hover:bg-fg/[0.06] hover:text-ink"
    >
      {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
    </motion.button>
  )
}

export function Nav() {
  const { m, to } = useI18n()
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const { scrollY, scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 })
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 8))
  useCmdK(useCallback(() => setOpen((o) => !o), []))
  const { rest } = stripLocale(useLocation().pathname)
  const active = rest.startsWith('/remote-servers') ? 'remote' : rest.startsWith('/clients') ? 'clients' : rest.startsWith('/loops') ? 'loops' : rest.startsWith('/cli') ? 'cli' : rest.startsWith('/skills') ? 'skills' : rest.startsWith('/agents') ? 'agents' : rest.startsWith('/servers') ? 'servers' : rest === '/' ? 'discover' : null
  // 各栏目的收录数量：浏览器里取一次，与首页共用
  const stats = useApi('site-stats', () => sharedStats()).data
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header ref={ref} className={clsx('sticky top-0 z-40 border-b transition-colors duration-300', scrolled ? 'border-line bg-bg/75 backdrop-blur-xl' : 'border-transparent bg-bg')}>
      <LocaleBanner />
      <div className="mx-auto max-w-[1248px] px-6">
        <div className="flex h-[68px] items-center justify-between gap-4 lg:gap-10">
          <Logo className="lg:w-[340px]" />
          <button
            onClick={() => setOpen(true)}
            className="hidden h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-fg/10 bg-fg/[0.04] px-3.5 text-left text-sm text-text3 transition-colors hover:border-fg/20 hover:bg-fg/[0.06] md:flex"
          >
            <MagnifyingGlass size={17} className="shrink-0" />
            <span className="flex-1 truncate">{m.nav.search}</span>
            <kbd className="rounded-[5px] border border-fg/10 bg-fg/[0.07] px-1.5 py-0.5 font-mono text-xs text-text2">⌘K</kbd>
          </button>
          <div className="flex shrink-0 items-center justify-end gap-1.5 lg:w-[340px]">
            <button onClick={() => setOpen(true)} aria-label={m.nav.searchAria} className="grid size-9 place-items-center rounded-lg text-text2 hover:bg-fg/[0.06] md:hidden"><MagnifyingGlass size={18} /></button>
            <LanguageMenu />
            <ThemeToggle label={m.nav.theme} />
            <AccountMenu />
          </div>
        </div>
        <nav className="-mx-1 overflow-x-auto px-1 pb-3 [scrollbar-width:none]" onMouseLeave={() => setHover(null)}>
          <div className="inline-flex items-center gap-0.5 rounded-xl border border-fg/[0.07] bg-fg/[0.025] p-1">
            {NAV_GROUPS.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-fg/10" />}
                {group.map((t) => {
                  const isActive = t.key === active
                  const n = stats && t.count ? t.count(stats) : null
                  return (
                    <Link
                      key={t.key}
                      to={t.to ? to(t.to) : '#'}
                      onMouseEnter={() => setHover(t.key)}
                      aria-current={isActive ? 'page' : undefined}
                      className={clsx(
                        'relative flex shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[9px] px-3 py-[7px] text-sm transition-colors',
                        isActive ? 'border border-fg/10 bg-fg/[0.08] font-semibold text-ink shadow-[0_2px_6px_rgba(0,0,0,0.25)]' : 'border border-transparent text-text2 hover:text-ink',
                      )}
                    >
                      {hover === t.key && !isActive && (
                        <motion.span layoutId="nav-hover" className="absolute inset-0 rounded-[9px] bg-fg/[0.05]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                      )}
                      <t.icon size={15} weight={isActive ? 'bold' : 'regular'} className={clsx('relative', isActive ? 'text-accent' : 'text-text3')} />
                      <span className="relative">{m.nav.tabs[t.key]}</span>
                      {n !== null && <span className="relative font-mono text-[11px] font-normal text-text3">{compactNumber(n)}</span>}
                      {t.key === 'feed' && <span className="relative size-1.5 rounded-full bg-accent" />}
                    </Link>
                  )
                })}
              </Fragment>
            ))}
          </div>
        </nav>
      </div>
      <motion.div aria-hidden className="absolute inset-x-0 bottom-[-1px] h-px origin-left bg-gradient-to-r from-accent to-blue" style={{ scaleX: progress }} />
      <SearchDialog open={open} onOpenChange={setOpen} />
    </header>
  )
}
