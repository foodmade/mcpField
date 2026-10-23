import { useEffect, useSyncExternalStore } from 'react'
import type { BaseItem, Kind } from './api/entities'
import { apiGet, apiSend } from './api/http'
import { accessToken, useSession } from './auth'
import type { Locale } from '../i18n/locales'

/*
 * 收藏：与后端 mcp-field-crawler/src/api/modules/favorites 对应，存在账号里，控制台「我的收藏」列出。
 * 第一版只有 MCP 服务和 Skill 能收藏。上线前收藏只存在浏览器本地（mcpfield.bookmarks），登录后并入账号再清掉。
 */

export const FAVORITE_KINDS: Kind[] = ['server', 'skill']
export const canFavorite = (kind: Kind) => FAVORITE_KINDS.includes(kind)

/** 收藏标识：类型 + slug，例如 server:playwright-mcp */
export const favoriteKey = (kind: Kind, slug: string) => `${kind}:${slug}`

export type Favorite = {
  kind: 'server' | 'skill'
  slug: string
  name: string
  favoritedAt: string
  /** 目录列表项；条目已下架时为 null */
  item: BaseItem | null
}

/** 上线前浏览器本地的收藏 */
const LEGACY_KEY = 'mcpfield.bookmarks'

/* 当前账号收藏了哪些条目：按账号加载一次，各组件共用；未登录或还没读到时为 null */
type Store = { userId: string | null; keys: Set<string> | null }
let store: Store = { userId: null, keys: null }
let loading: { userId: string; promise: Promise<void> } | null = null
const listeners = new Set<() => void>()
const set = (next: Store) => {
  store = next
  listeners.forEach((l) => l())
}
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function legacyKeys(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

async function load(userId: string) {
  const token = await accessToken()
  const legacy = legacyKeys()
  let keys: string[]
  if (legacy.length > 0) {
    keys = (await apiSend<{ data: string[] }>('POST', '/favorites/import', { keys: legacy.slice(-200) }, token)).data
    localStorage.removeItem(LEGACY_KEY)
  } else {
    keys = (await apiGet<{ data: string[] }>('/favorites/keys', {}, undefined, token)).data
  }
  if (store.userId === userId) set({ userId, keys: new Set(keys) })
}

function ensureLoaded(userId: string | null) {
  if (store.userId !== userId) set({ userId, keys: null })
  if (!userId || store.keys || loading?.userId === userId) return
  const promise = load(userId)
    .catch(() => undefined)
    .finally(() => {
      if (loading?.promise === promise) loading = null
    })
  loading = { userId, promise }
}

const edit = (key: string, on: boolean) => {
  if (!store.keys) return
  const keys = new Set(store.keys)
  if (on) keys.add(key)
  else keys.delete(key)
  set({ ...store, keys })
}

/** 收藏或取消收藏：先改界面，请求失败时恢复并抛出错误。favoritedAt 用于撤销取消收藏时恢复原来的收藏时间 */
export async function setFavorite(kind: Kind, slug: string, on: boolean, favoritedAt?: string): Promise<void> {
  const key = favoriteKey(kind, slug)
  edit(key, on)
  try {
    const path = `/favorites/${kind}/${encodeURIComponent(slug)}`
    if (on) await apiSend('PUT', path, favoritedAt ? { favoritedAt } : {}, await accessToken())
    else await apiSend('DELETE', path, undefined, await accessToken())
  } catch (error) {
    edit(key, !on)
    throw error
  }
}

/**
 * 当前账号的收藏标识。ready：已登录且读到了收藏（未登录时为 false，keys 为空）。
 * 服务端渲染时按未登录处理。
 */
export function useFavorites() {
  const { user, pending } = useSession()
  const userId = user?.id ?? null
  useEffect(() => {
    if (!pending) ensureLoaded(userId)
  }, [userId, pending])
  const snapshot = useSyncExternalStore(subscribe, () => store, () => store)
  const keys = snapshot.userId === userId ? snapshot.keys : null
  return { user, pending, ready: !!keys, keys: keys ?? new Set<string>() }
}

/** 控制台列表：全部收藏（带目录列表项） */
export async function fetchFavorites(locale: Locale, signal?: AbortSignal): Promise<Favorite[]> {
  return (await apiGet<{ data: Favorite[] }>('/favorites', { locale }, signal, await accessToken())).data
}

/* 收藏的轻提示（右下角）：详情页和控制台共用，同一时间只显示一条 */
export type FavoriteToast = { id: number; tone: 'added' | 'removed' | 'failed'; title: string; desc?: string; action?: { label: string; href?: string; run?: () => void } }
let toast: FavoriteToast | null = null
let toastSeq = 0
const toastListeners = new Set<() => void>()
const subscribeToast = (cb: () => void) => {
  toastListeners.add(cb)
  return () => toastListeners.delete(cb)
}

export function showToast(next: Omit<FavoriteToast, 'id'> | null) {
  toast = next && { ...next, id: ++toastSeq }
  toastListeners.forEach((l) => l())
}

export const useToast = () => useSyncExternalStore(subscribeToast, () => toast, () => null)
