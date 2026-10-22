import { useEffect, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { ViewHandle } from './engine'
import { posterOf } from './posters'

/**
 * 3D 图标（model 是 models.ts 的键）：先显示预渲染的静态图（服务端渲染、首屏、没有 JS 时都能看到），
 * 接近视口时才加载 three.js 渲染引擎（单独的 chunk），在画布上播放待机动画；第一帧和静态图是同一画面，画好后淡入替换。
 * active 为 true（所在卡片被悬停或聚焦）时动画更活跃。
 * lazy：静态图懒加载，用在首屏以下的位置。否则服务端渲染会在页头为它生成 preload，慢网下和首屏资源抢带宽。
 */
export function Category3D({ model, size, active = false, lazy = false, className, style }: { model: string; size: number; active?: boolean; lazy?: boolean; className?: string; style?: CSSProperties }) {
  const poster = posterOf(model)
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useRef<ViewHandle | null>(null)
  const activeRef = useRef(active)
  const [live, setLive] = useState(false)

  useEffect(() => {
    activeRef.current = active
    view.current?.setActive(active)
  }, [active])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    let alive = true
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        // 引擎初始化是一段几百毫秒的长任务（中端手机上），等浏览器空闲再做，不卡住正在进行的滚动和点击（INP）
        new Promise((resolve) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(resolve, { timeout: 2000 }) : setTimeout(resolve, 200)))
          .then(() => (alive ? import('./engine') : Promise.reject()))
          .then(({ mountView }) => {
            if (!alive) return
            canvas.width = canvas.height = Math.round(size * Math.min(window.devicePixelRatio || 1, 2))
            view.current = mountView(canvas, model)
            view.current?.setActive(activeRef.current)
            setLive(view.current !== null)
          })
          .catch(() => {
            /* 引擎加载失败时保留静态图 */
          })
      },
      { rootMargin: '200px' },
    )
    io.observe(canvas)
    return () => {
      alive = false
      io.disconnect()
      view.current?.dispose()
      view.current = null
    }
  }, [model, size])

  return (
    <div aria-hidden className={clsx('relative', className)} style={{ width: size, height: size, ...style }}>
      {poster && (
        <img src={poster} alt={model.replace(/-/g, ' ')} width={size} height={size} loading={lazy ? 'lazy' : undefined} decoding="async" draggable={false} className={clsx('absolute inset-0 size-full transition-opacity duration-300', live && 'opacity-0')} />
      )}
      <canvas ref={ref} className={clsx('absolute inset-0 size-full transition-opacity duration-300', live ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}
