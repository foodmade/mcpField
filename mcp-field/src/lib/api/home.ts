import type { Locale } from '../../i18n/locales'
import { apiGet } from './http'
import { fetchList, type ItemOf, type Kind } from './entities'

/**
 * 首页推荐：先取源站标记为精选的条目（按热度），不足 n 个时用最热门的补齐。
 */
export async function fetchFeatured<K extends Kind>(kind: K, n: number, locale: Locale, signal?: AbortSignal, extra: { remote?: boolean } = {}): Promise<ItemOf[K][]> {
  const [featured, popular] = await Promise.all([
    fetchList(kind, { page: 1, pageSize: n, featured: true, sort: 'popular', locale, ...extra }, signal),
    fetchList(kind, { page: 1, pageSize: n * 2, sort: 'popular', locale, ...extra }, signal),
  ])
  const seen = new Set(featured.data.map((i) => i.slug))
  return [...featured.data, ...popular.data.filter((i) => !seen.has(i.slug))].slice(0, n)
}

/* 与后端 mcp-field-crawler/src/api/modules/stats 的返回结构保持一致 */

/** 全站统计：各类型总数、远程服务数、近 14 天每天新增（按源站上架日期）、最近一次发布时间 */
export type SiteStats = {
  totals: Record<Kind, number>
  remote: number
  daily: { date: string; count: number }[]
  publishedAt: string | null
}

export const fetchStats = (signal?: AbortSignal) => apiGet<{ data: SiteStats }>('/stats', {}, signal).then((r) => r.data)

/** 浏览器里多个组件（导航、首页）共用一份统计，几分钟内不重复请求 */
let statsCache: { at: number; value: Promise<SiteStats> } | null = null
export function sharedStats(): Promise<SiteStats> {
  if (!statsCache || Date.now() - statsCache.at > 5 * 60_000) {
    const value = fetchStats()
    statsCache = { at: Date.now(), value }
    value.catch(() => (statsCache = null))
  }
  return statsCache.value
}

/** 首屏背景里流动的名字：最热门的服务与 Skill（精简字段） */
export type FieldItem = {
  kind: 'server' | 'skill'
  slug: string
  name: string
  category: string | null
  tagline: string | null
  iconUrl: string | null
  author: string | null
  verified: boolean
  /** 服务是星数，Skill 是安装量 */
  metric: number | null
  toolsCount?: number
  isRemote?: boolean
  installCommand?: string | null
}

export const fetchField = (locale: Locale, signal?: AbortSignal) => apiGet<{ data: FieldItem[] }>('/stats/field', { locale }, signal).then((r) => r.data)
