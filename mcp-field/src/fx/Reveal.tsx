import { motion, type Variants } from 'motion/react'
import type { ReactNode } from 'react'
import { useEnterAnimation } from './hydration'

const ease = [0.22, 1, 0.36, 1] as const

export const revealItem: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.7, ease } },
}

// 进入视口时子元素依次浮现；服务端渲染出的内容直接显示（见 useEnterAnimation）
export function RevealGroup({ children, className, stagger = 0.08, delay = 0 }: { children: ReactNode; className?: string; stagger?: number; delay?: number }) {
  const enter = useEnterAnimation()
  return (
    <motion.div
      className={className}
      initial={enter ? 'hidden' : false}
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  )
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={revealItem}>
      {children}
    </motion.div>
  )
}

// 标题逐字浮现
export function SplitText({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const enter = useEnterAnimation()
  const lines = text.split('\n')
  let i = 0
  return (
    <motion.h1
      className={className}
      initial={enter ? 'hidden' : false}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035, delayChildren: delay } } }}
    >
      {lines.map((line, li) => (
        <span key={li} className="block">
          {Array.from(line).map((ch) => (
            <motion.span
              key={i++}
              className="inline-block whitespace-pre"
              variants={{
                hidden: { opacity: 0, y: '0.5em', filter: 'blur(10px)' },
                show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease } },
              }}
            >
              {ch}
            </motion.span>
          ))}
        </span>
      ))}
    </motion.h1>
  )
}
