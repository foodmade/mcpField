import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'

export type SectionItem<T extends string> = { id: T; label: string; count?: number }

/** 页内导航的高度（含下边框），区块标题滚到导航下方时留出的距离 */
const SECTION_NAV_H = 56
const offset = () => (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 110) + SECTION_NAV_H

/** 滚动时高亮当前所在区块；ids 按页面上的先后顺序排列 */
export function useActiveSection<T extends string>(ids: readonly T[], dep: unknown) {
  const [active, setActive] = useState<T>(ids[0])
  const refs = useRef<Partial<Record<T, HTMLElement | null>>>({})
  const key = ids.join()
  useEffect(() => {
    const onScroll = () => {
      const y = offset() + 8
      let cur = ids[0]
      for (const id of ids) {
        const el = refs.current[id]
        if (el && el.getBoundingClientRect().top <= y) cur = id
      }
      setActive(cur)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep, key])
  const jump = (id: T) => {
    const el = refs.current[id]
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset(), behavior: 'smooth' })
  }
  const reg = (id: T) => (el: HTMLElement | null) => {
    refs.current[id] = el
  }
  return { active, jump, reg }
}

/** 吸顶的页内导航：点击跳到对应区块，滚动时下划线跟随当前区块 */
export function SectionNav<T extends string>({ items, active, onJump }: { items: SectionItem<T>[]; active: T; onJump: (id: T) => void }) {
  const { m } = useI18n()
  return (
    <div className="sticky z-30 border-b border-line bg-bg/80 backdrop-blur-xl" style={{ top: 'var(--nav-h, 110px)' }}>
      <nav aria-label={m.detail.sectionNav} className="mx-auto flex max-w-[1248px] gap-7 overflow-x-auto px-6 [scrollbar-width:none]">
        {items.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => onJump(id)}
            aria-current={active === id ? 'true' : undefined}
            className={clsx('relative flex shrink-0 items-center gap-1.5 py-3 text-sm transition-colors', active === id ? 'font-semibold text-ink' : 'text-text2 hover:text-ink')}
          >
            {label}
            {!!count && <span className="rounded-full bg-fg/10 px-1.5 tabular-nums text-xs text-text2">{count}</span>}
            {active === id && <motion.span layoutId="detail-tab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        ))}
      </nav>
    </div>
  )
}
