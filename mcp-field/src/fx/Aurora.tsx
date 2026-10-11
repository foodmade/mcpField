import { motion, useMotionTemplate, useMotionValue, useSpring } from 'motion/react'
import type { PointerEvent, ReactNode } from 'react'
import clsx from 'clsx'

type Orb = { x: string; y: string; size: number; color: string; round?: boolean; blur?: number; dur: number; path: [number[], number[]] }

const ORBS: Orb[] = [
  { x: '-5%', y: '-17%', size: 240, color: '#1D4ED84D', dur: 22, path: [[0, 40, -10, 0], [0, 30, 60, 0]] },
  { x: '12%', y: '-9%', size: 150, color: '#0EA5E933', dur: 18, path: [[0, -30, 20, 0], [0, 40, 10, 0]] },
  { x: '39%', y: '-6%', size: 120, color: '#4F46E540', round: true, dur: 24, path: [[0, 50, -20, 0], [0, 20, 40, 0]] },
  { x: '82%', y: '65%', size: 260, color: '#0EA5E929', blur: 30, dur: 26, path: [[0, -60, 20, 0], [0, -40, 10, 0]] },
  { x: '30%', y: '80%', size: 170, color: '#1D4ED833', round: true, dur: 20, path: [[0, 40, 80, 0], [0, -30, -10, 0]] },
  { x: '5%', y: '72%', size: 90, color: '#3DDC9726', dur: 16, path: [[0, 30, -20, 0], [0, -40, 20, 0]] },
  { x: '58%', y: '-26%', size: 420, color: '#3DDC9714', blur: 80, dur: 30, path: [[0, -40, 30, 0], [0, 50, 20, 0]] },
]

// 首屏沉浸背景：漂浮光斑 + 网格 + 指针聚光
export function AuroraBanner({ children, className }: { children: ReactNode; className?: string }) {
  const mx = useSpring(useMotionValue(70), { stiffness: 60, damping: 20 })
  const my = useSpring(useMotionValue(30), { stiffness: 60, damping: 20 })
  const spot = useMotionTemplate`radial-gradient(520px circle at ${mx}% ${my}%, rgba(61,220,151,0.14), transparent 60%)`

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(((e.clientX - r.left) / r.width) * 100)
    my.set(((e.clientY - r.top) / r.height) * 100)
  }

  return (
    <div
      onPointerMove={onMove}
      className={clsx('relative isolate overflow-hidden rounded-[22px] border border-white/[0.08]', className)}
      style={{
        background:
          'radial-gradient(90% 130% at 78% 35%, #2B7FFF33, transparent 60%), radial-gradient(90% 110% at 15% 100%, #3DDC9729, transparent 60%), linear-gradient(200deg, #0B1730 0%, #0A1620 55%, #07211C 100%)',
      }}
    >
      {ORBS.map((o, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="pointer-events-none absolute -z-10"
          style={{
            left: o.x,
            top: o.y,
            width: o.size,
            height: o.round ? o.size * 0.66 : o.size,
            borderRadius: o.round ? 24 : 9999,
            background: o.color,
            filter: o.blur ? `blur(${o.blur}px)` : undefined,
          }}
          animate={{ x: o.path[0], y: o.path[1] }}
          transition={{ duration: o.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '100px 92px',
          maskImage: 'radial-gradient(80% 90% at 50% 40%, #000 30%, transparent 85%)',
        }}
      />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: spot }} />
      {children}
    </div>
  )
}
