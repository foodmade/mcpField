import type { Kind } from './entities'
import { apiGet } from './http'

/** 单个 sitemap 文件的条目数（规范上限 5 万，取小一些让单个文件更轻） */
export const SITEMAP_PAGE_SIZE = 10_000

export const fetchSitemapSummary = (signal?: AbortSignal) =>
  apiGet<{ data: { kind: Kind; route: string; total: number }[] }>('/sitemap', {}, signal).then((r) => r.data)

export const fetchSitemapPage = (kind: Kind, page: number, signal?: AbortSignal) =>
  apiGet<{ data: { slug: string; updatedAt: string | null }[] }>(`/sitemap/${kind}`, { page, pageSize: SITEMAP_PAGE_SIZE }, signal).then((r) => r.data)
