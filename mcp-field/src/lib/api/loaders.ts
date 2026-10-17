import { data } from 'react-router'
import { DEFAULT_LOCALE, localeFromParam } from '../../i18n/locales'
import { categoryOf, categoryParam, PAGE_SIZE, type SortKey } from '../categories'
import { parseDirectoryQuery, type DirectoryConfig } from '../directoryQuery'
import { parseTagsQuery, TAG_PAGE_SIZE } from '../tagsQuery'
import { fetchDetail, fetchFacets, fetchList, type Kind, type ListParams } from './entities'
import { fetchFeatured, fetchStats } from './home'
import { ApiError } from './http'
import { fetchTags } from './tags'
import { BLOG_CATEGORIES, fetchBlogList, fetchBlogPost, type BlogCategory } from './blog'
import { BLOG_PAGE_SIZE } from '../blog'

/*
 * 各页面 loader 的数据加载逻辑：在服务端执行（首屏 HTML 直接带数据），
 * 站内跳转时由浏览器请求前端服务的 .data 接口，再由服务端转调 API。
 */

type Args = { request: Request; params: { lang?: string; slug?: string } }

export const localeOf = (params: { lang?: string }) => localeFromParam(params.lang) ?? DEFAULT_LOCALE

/** 抛给 ErrorBoundary 的 404：服务端会返回 404 状态码 */
const notFound = () => data(null, { status: 404 })

/** 页面排序 → 接口排序：最热门按该类型的热度指标（星数 / 安装量 / 浏览量） */
const SORT: Record<SortKey, NonNullable<ListParams['sort']>> = { hot: 'popular', new: 'newest', name: 'name' }

/** 详情页：详情 + 同分类推荐（推荐失败不影响页面） */
export async function loadDetail<K extends Kind>(kind: K, { request, params }: Args) {
  const locale = localeOf(params)
  if (!params.slug) throw notFound()
  const d = await fetchDetail(kind, params.slug, locale, request.signal).catch((e: unknown) => {
    throw e instanceof ApiError && e.notFound ? notFound() : e
  })
  const category = categoryParam(categoryOf(kind, d.category?.slug).slug)
  const related = await fetchList(kind, { page: 1, pageSize: 5, category, sort: 'popular', locale }, request.signal).then(
    (r) => r.data.filter((i) => i.slug !== d.slug).slice(0, 4),
    () => [],
  )
  return { d, related }
}

export type DirectorySpec<K extends Kind> = DirectoryConfig & { kind: K; remote?: boolean }

/** 目录页：URL 里的筛选、搜索、排序、页码转成接口参数；侧栏计数来自 facets */
export async function loadDirectory<K extends Kind>(spec: DirectorySpec<K>, { request, params }: Args) {
  const locale = localeOf(params)
  const q = parseDirectoryQuery(new URL(request.url).searchParams, spec)
  const listParams: ListParams = {
    page: q.page,
    pageSize: PAGE_SIZE,
    q: q.q || undefined,
    category: categoryParam(q.category),
    featured: q.view === 'featured' || undefined,
    verified: q.view === 'verified' || undefined,
    official: q.view === 'official' || undefined,
    remote: spec.remote || undefined,
    type: q.type ?? undefined,
    tag: q.tag ?? undefined,
    sort: SORT[q.sort],
    locale,
  }
  const [list, facets] = await Promise.all([
    fetchList(spec.kind, listParams, request.signal),
    fetchFacets(spec.kind, spec.remote ? { remote: true } : {}, request.signal),
  ])
  // 超出范围的页码不生成空页面
  if (q.page > 1 && list.data.length === 0) throw notFound()
  return { list, facets }
}

/** 标签页：URL 里的类型、关键词、首字母、排序、页码转成接口参数 */
export async function loadTags({ request }: Args) {
  const q = parseTagsQuery(new URL(request.url).searchParams)
  const list = await fetchTags({ kind: q.kind ?? undefined, q: q.q || undefined, letter: q.letter ?? undefined, sort: q.sort, page: q.page, pageSize: TAG_PAGE_SIZE }, request.signal)
  if (q.page > 1 && list.data.length === 0) throw notFound()
  return list
}

/** 首页：推荐、排行、分类计数、全站统计一次并行取回；统计和补充数据失败时只隐藏对应区块 */
export async function loadHome({ request, params }: Args) {
  const locale = localeOf(params)
  const signal = request.signal
  const soft = <T>(p: Promise<T>) => p.catch(() => null)
  const [hero, client, cli, loop, skill, hot, skillRank, facets, stats, recent] = await Promise.all([
    fetchFeatured('server', 5, locale, signal),
    fetchFeatured('client', 4, locale, signal),
    fetchFeatured('cli', 4, locale, signal),
    fetchFeatured('loop', 4, locale, signal),
    fetchFeatured('skill', 4, locale, signal),
    fetchList('server', { page: 1, pageSize: 6, sort: 'popular', locale }, signal).then((r) => r.data),
    // Skill 的热度就是安装量（POPULAR_METRIC），popular 走搜索表的主键顺序，比 installs 的现算排序快得多
    fetchList('skill', { page: 1, pageSize: 7, sort: 'popular', locale }, signal).then((r) => r.data),
    fetchFacets('server', {}, signal),
    soft(fetchStats(signal)),
    soft(fetchList('server', { page: 1, pageSize: 4, sort: 'newest', locale }, signal).then((r) => r.data)),
  ])
  // 热门分类拼贴：前三个分类各取几个代表服务；精选大卡要展示接入命令和工具，需要详情
  const top = facets.categories.filter((c) => c.slug).sort((a, b) => b.count - a.count).slice(0, 3)
  const [reps, spotlight] = await Promise.all([
    Promise.all(top.map((c) => soft(fetchList('server', { page: 1, pageSize: 6, category: c.slug!, sort: 'popular', locale }, signal).then((r) => [c.slug!, [...new Set(r.data.map((i) => i.name))]] as const)))),
    hero[0] ? soft(fetchDetail('server', hero[0].slug, locale, signal)) : null,
  ])
  return {
    hero,
    featured: { server: hero, client, cli, loop, skill },
    spotlight,
    hot,
    skillRank,
    facets,
    stats,
    recent: recent ?? [],
    reps: Object.fromEntries(reps.filter((r) => r !== null)) as Record<string, string[]>,
  }
}

/** 排行榜条数 */
export const RANK_SIZE = 100

/** 排行榜：按星数取前 100 个 MCP 服务；候选总数来自全站统计（失败时不显示） */
export async function loadRankings({ request, params }: Args) {
  const locale = localeOf(params)
  const [list, stats] = await Promise.all([
    fetchList('server', { page: 1, pageSize: RANK_SIZE, sort: 'stars', locale, withTotal: false }, request.signal),
    fetchStats(request.signal).catch(() => null),
  ])
  return { rows: list.data, total: stats?.totals.server ?? null }
}

/** 博客列表：URL 里的栏目、标签、关键词、页码 */
export function parseBlogQuery(sp: URLSearchParams) {
  const category = sp.get('category')
  const page = Number(sp.get('page') ?? 1)
  return {
    category: (BLOG_CATEGORIES as readonly string[]).includes(category ?? '') ? (category as BlogCategory) : null,
    tag: sp.get('tag')?.trim().toLowerCase().slice(0, 64) || null,
    q: sp.get('q')?.trim().slice(0, 100) || '',
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

export async function loadBlogList({ request, params }: Args) {
  const q = parseBlogQuery(new URL(request.url).searchParams)
  const list = await fetchBlogList({ category: q.category ?? undefined, tag: q.tag ?? undefined, q: q.q || undefined, page: q.page, pageSize: BLOG_PAGE_SIZE, locale: localeOf(params) }, request.signal)
  if (q.page > 1 && list.data.length === 0) throw notFound()
  return list
}

export async function loadBlogPost({ request, params }: Args) {
  if (!params.slug) throw notFound()
  return fetchBlogPost(params.slug, localeOf(params), request.signal).catch((e: unknown) => {
    throw e instanceof ApiError && e.notFound ? notFound() : e
  })
}
