import { motion, useMotionTemplate, useMotionValue } from 'motion/react'
import type { PointerEvent, ReactNode } from 'react'
import clsx from 'clsx'

type Props = {
  glow?: string
  className?: string
  children: ReactNode
  lift?: boolean
  /** 角落的常驻渐变光；关掉后只在悬停时出现聚光 */
  ambient?: boolean
}

// 卡片角落常驻渐变光 + 跟随指针的聚光与描边高亮
export function SpotlightCard({ glow = '#3DDC97', className, children, lift = true, ambient = true }: Props) {
  const mx = useMotionValue(-400)
  const my = useMotionValue(-400)
  const spot = useMotionTemplate`radial-gradient(280px circle at ${mx}px ${my}px, ${glow}22, transparent 70%)`
  const rim = useMotionTemplate`radial-gradient(220px circle at ${mx}px ${my}px, ${glow}aa, transparent 70%)`

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(e.clientX - r.left)
    my.set(e.clientY - r.top)
  }

  return (
    <motion.div
      onPointerMove={onMove}
      whileHover={lift ? { y: -4 } : undefined}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={clsx('group relative isolate rounded-2xl border border-fg/[0.07]', className)}
      style={{
        background: ambient ? `radial-gradient(110% 130% at 100% 0%, ${glow}30, transparent 62%), var(--color-surface)` : 'var(--color-surface)',
      }}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: spot }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] p-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: rim,
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
        }}
      />
      {children}
    </motion.div>
  )
}
