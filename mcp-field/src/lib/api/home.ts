import type { Locale } from '../../i18n/locales'
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
