import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useEnterAnimation } from './hydration'

const fmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString('en-US'))

/** 数字滚动：服务端渲染时直接输出最终数值（爬虫和首屏看到的都是真实数字），之后挂载的才从 0 滚动 */
export function CountUp({ value, className, format = fmt }: { value: number; className?: string; format?: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const enter = useEnterAnimation()
  const animated = enter && !reduce
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!inView || !animated) return
    const c = animate(0, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1], onUpdate: setShown })
    return () => c.stop()
  }, [inView, value, animated])

  return (
    <span ref={ref} className={className}>
      {format(animated ? shown : value)}
    </span>
  )
}
