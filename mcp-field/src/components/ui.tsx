import { motion } from 'motion/react'
import { ArrowRight } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Magnetic } from '../fx/Magnetic'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'

export function Tile({ label, bg, fg = '#fff', size = 40, className }: { label: string; bg: string; fg?: string; size?: number; className?: string }) {
  return (
    <div
      className={clsx('grid shrink-0 place-items-center font-bold', className)}
      style={{ width: size, height: size, borderRadius: size * 0.26, background: bg, color: fg, fontSize: size * 0.4 }}
    >
      {label}
    </div>
  )
}

export function Chip({ children, mono, className }: { children: ReactNode; mono?: boolean; className?: string }) {
  return (
    <span className={clsx('whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-[11px] tracking-[0.02em] text-text2', mono && 'tabular-nums', className)}>
      {children}
    </span>
  )
}

export function LinkArrow({ children, href = '#', className }: { children: ReactNode; href?: string; className?: string }) {
  const { to } = useI18n()
  const cls = clsx('group inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-text2 transition-colors hover:text-ink', className)
  const inner = (
    <>
      {children}
      <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
    </>
  )
  return href.startsWith('/') ? <Link to={to(href)} className={cls}>{inner}</Link> : <a href={href} className={cls}>{inner}</a>
}

export function SectionHeader({ title, sub, link, href }: { title: string; sub?: string; link?: string; href?: string }) {
  return (
    <RevealGroup className="mb-5 flex items-end justify-between gap-6">
      <RevealItem>
        <h2 className="text-xl font-bold tracking-tight md:text-[22px]">{title}</h2>
        {sub && <p className="mt-1.5 text-sm text-text2">{sub}</p>}
      </RevealItem>
      {link && (
        <RevealItem>
          <LinkArrow href={href} className="font-medium text-ink">{link}</LinkArrow>
        </RevealItem>
      )}
    </RevealGroup>
  )
}

export function ShimmerButton({ children, icon, className }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <Magnetic>
      <motion.button
        whileTap={{ scale: 0.96 }}
        className={clsx(
          'group relative inline-flex h-[42px] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-accent px-[18px] text-sm font-semibold text-accent-ink shadow-[0_8px_30px_-6px_#3DDC9780]',
          className,
        )}
      >
        <motion.span
          aria-hidden
          className="absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-20deg] bg-gradient-to-r from-transparent via-white/60 to-transparent"
          animate={{ x: ['0%', '400%'] }}
          transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
        />
        {icon && <span className="relative">{icon}</span>}
        <span className="relative">{children}</span>
        {!icon && <ArrowRight weight="bold" className="relative transition-transform duration-300 group-hover:translate-x-1" size={15} />}
      </motion.button>
    </Magnetic>
  )
}

export function RoundBtn({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <motion.button
      aria-label={label}
      onClick={onClick}
      whileHover={{ scale: 1.08, backgroundColor: 'rgba(255,255,255,0.14)' }}
      whileTap={{ scale: 0.92 }}
      className="grid size-[34px] place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/90"
    >
      {children}
    </motion.button>
  )
}

export function Container({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx('mx-auto w-full max-w-[1248px] px-6', className)}>
      {children}
    </section>
  )
}
