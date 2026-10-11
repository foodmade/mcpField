import { useSyncExternalStore } from 'react'

/*
 * 明暗主题：<html data-theme="dark|light">。
 * 首次访问跟随系统设置；手动切换后记在 localStorage，之后一直沿用。
 * 首次绘制前由 root 里的内联脚本（THEME_SCRIPT）设置好，避免先闪一下另一种主题。
 */

export type Theme = 'dark' | 'light'
export const THEME_KEY = 'mcpfield.theme'
const THEME_COLOR: Record<Theme, string> = { dark: '#0A0B0D', light: '#FAFAF8' }

/** 在 <head> 里同步执行：读取已保存的选择，没有时跟随系统 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';var d=document.documentElement;d.dataset.theme=t;var m=document.querySelector('meta[name=theme-color]');if(m)m.content=t==='light'?'${THEME_COLOR.light}':'${THEME_COLOR.dark}'}catch(e){}})()`

const listeners = new Set<() => void>()

function current(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLOR[theme])
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* 隐私模式下无法保存，只对当前页面生效 */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 当前主题；服务端渲染和水合时为 null（那时还不知道用户的选择） */
export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, current, () => null)
}
