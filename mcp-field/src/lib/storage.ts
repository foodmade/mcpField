import { useCallback, useSyncExternalStore } from 'react'

/*
 * 读写 localStorage / sessionStorage 的 hook：服务端和水合时返回 null，避免服务端报错和水合不一致；
 * 同一页面内多个组件读写同一个键时互相同步。
 */

type Area = 'local' | 'session'
const listeners = new Set<() => void>()

const area = (a: Area): Storage | null => {
  try {
    return a === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

export function useStorage(key: string, a: Area = 'local'): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => area(a)?.getItem(key) ?? null, () => null)
  const set = useCallback(
    (v: string) => {
      area(a)?.setItem(key, v)
      listeners.forEach((l) => l())
    },
    [key, a],
  )
  return [value, set]
}

/** 解析 JSON，格式不对时返回默认值 */
export function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
