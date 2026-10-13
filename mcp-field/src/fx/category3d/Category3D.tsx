import { useEffect, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { ViewHandle } from './engine'
import { posterOf } from './posters'

/**
 * 3D 图标（model 是 models.ts 的键）：先显示预渲染的静态图（服务端渲染、首屏、没有 JS 时都能看到），
 * 接近视口时才加载 three.js 渲染引擎（单独的 chunk），在画布上播放待机动画；第一帧和静态图是同一画面，画好后淡入替换。
 * active 为 true（所在卡片被悬停或聚焦）时动画更活跃。
 */
export function Category3D({ model, size, active = false, className, style }: { model: string; size: number; active?: boolean; className?: string; style?: CSSProperties }) {
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
        import('./engine')
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
        <img src={poster} alt="" width={size} height={size} decoding="async" draggable={false} className={clsx('absolute inset-0 size-full transition-opacity duration-300', live && 'opacity-0')} />
      )}
      <canvas ref={ref} className={clsx('absolute inset-0 size-full transition-opacity duration-300', live ? 'opacity-100' : 'opacity-0')} />
    </div>
  )
}
