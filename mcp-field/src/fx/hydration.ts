import { useState, useSyncExternalStore } from 'react'

const noop = () => () => {}

/** 是否已完成水合：服务端渲染和水合那一次渲染为 false，之后为 true */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false)
}

/**
 * 是否播放入场动画：服务端渲染出的内容直接显示最终状态（首屏可见、不拖慢 LCP），
 * 只有水合之后才挂载的内容（站内跳转、展开等）才播放入场动画。
 */
export function useEnterAnimation() {
  const hydrated = useHydrated()
  const [animate] = useState(hydrated)
  return animate
}
