import { motion, useMotionValueEvent, useScroll, useSpring } from 'motion/react'
import { Megaphone, MagnifyingGlass, Moon, Sun } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import { stripLocale } from '../i18n/locales'
import { setTheme, useTheme } from '../lib/theme'
import { AccountMenu } from './AccountMenu'
import { LanguageMenu } from './LanguageMenu'
import { LocaleBanner } from './LocaleBanner'
import { Logo } from './Logo'
import { SearchDialog, useCmdK } from './SearchDialog'

/** 顶部导航：没有 to 的栏目尚未上线 */
const NAV_TABS = [
  { key: 'discover', to: '/' },
  { key: 'servers', to: '/servers' },
  { key: 'remote', to: '/remote-servers' },
  { key: 'clients', to: '/clients' },
  { key: 'cli', to: '/cli' },
  { key: 'loops', to: '/loops' },
  { key: 'skills', to: '/skills' },
  { key: 'agents', to: '/agents' },
  { key: 'feed' },
] as const

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
            <a href="#" className="hidden h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm transition-colors hover:bg-fg/[0.06] lg:flex"><Megaphone size={15} />{m.nav.ad}</a>
            <LanguageMenu />
            <ThemeToggle label={m.nav.theme} />
            <AccountMenu />
          </div>
        </div>
        <nav className="-mb-px flex gap-9 overflow-x-auto [scrollbar-width:none]" onMouseLeave={() => setHover(null)}>
          {NAV_TABS.map((t) => {
            const label = m.nav.tabs[t.key]
            const isActive = t.key === active
            return (
              <Link
                key={t.key}
                to={'to' in t ? to(t.to) : '#'}
                onMouseEnter={() => setHover(t.key)}
                aria-current={isActive ? 'page' : undefined}
                className={clsx('relative shrink-0 pb-3 pt-2 text-sm transition-colors', isActive ? 'font-semibold text-ink' : 'text-text2 hover:text-ink')}
              >
                {label}
                {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-ink" />}
                {hover === t.key && !isActive && (
                  <motion.span layoutId="nav-hover" className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-fg/30" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                )}
              </Link>
            )
          })}
        </nav>
      </div>
      <motion.div aria-hidden className="absolute inset-x-0 bottom-[-1px] h-px origin-left bg-gradient-to-r from-accent to-blue" style={{ scaleX: progress }} />
      <SearchDialog open={open} onOpenChange={setOpen} />
    </header>
  )
}
