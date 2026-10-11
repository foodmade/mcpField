import { motion, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

export type Token = [text: string, color: string]

// 按字符逐步打出带语法色的配置片段
export function CodeTypewriter({ lines, speed = 18, className }: { lines: Token[][]; speed?: number; className?: string }) {
  const ref = useRef<HTMLPreElement>(null)
  const inView = useInView(ref, { once: false, amount: 0.5 })
  const reduce = useReducedMotion()
  const total = lines.reduce((s, l) => s + l.reduce((a, [t]) => a + t.length, 0) + 1, 0)
  const [n, setN] = useState(reduce ? total : 0)

  useEffect(() => {
    if (reduce) {
      setN(total)
      return
    }
    if (!inView) return
    setN(0)
    const id = setInterval(() => setN((v) => (v >= total ? (clearInterval(id), v) : v + 1)), speed)
    return () => clearInterval(id)
  }, [inView, total, speed, reduce, lines])

  let left = n
  return (
    <pre ref={ref} className={className}>
      {lines.map((line, li) => {
        const out = line.map(([t, c], ti) => {
          const take = Math.max(0, Math.min(t.length, left))
          left -= t.length
          return take > 0 ? (
            <span key={ti} style={{ color: c }}>
              {t.slice(0, take)}
            </span>
          ) : null
        })
        left -= 1
        const typing = left < 0 && left >= -line.reduce((a, [t]) => a + t.length, 0) - 1
        return (
          <div key={li} className="min-h-[1.6em]">
            {out}
            {typing && n < total && (
              <motion.span
                className="ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-accent"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity, repeatType: 'reverse' }}
              />
            )}
          </div>
        )
      })}
    </pre>
  )
}
