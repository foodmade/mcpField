import { SORT_KEYS, type Category, type SortKey, type ViewKey } from './categories'

/*
 * 目录页的 URL 参数：服务端 loader 和页面组件共用同一套解析规则，
 * 不合法的取值一律忽略（按默认值处理），避免无效参数生成大量重复页面。
 */

export const ALL_VIEWS: ViewKey[] = ['official', 'featured', 'verified']
export const DEFAULT_VIEWS: ViewKey[] = ['featured', 'verified']

/** 目录页的配置：分类、侧栏视图、子类型（Agent 的产品 / 模板） */
export type DirectoryConfig = { categories: Category[]; views?: ViewKey[]; types?: string[] }

export type DirectoryQuery = { view: ViewKey | null; category: string | null; type: string | null; tag: string | null; sort: SortKey; q: string; page: number }

export function parseDirectoryQuery(sp: URLSearchParams, { categories, views = DEFAULT_VIEWS, types = [] }: DirectoryConfig): DirectoryQuery {
  const rawView = sp.get('view') as ViewKey | null
  const view = rawView && ALL_VIEWS.includes(rawView) && views.includes(rawView) ? rawView : null
  const rawCat = sp.get('category')
  // 快捷视图与分类互斥
  const category = !view && rawCat && categories.some((c) => c.slug === rawCat) ? rawCat : null
  const rawType = sp.get('type')
  const type = rawType && types.includes(rawType) ? rawType : null
  // 标签可以和其他筛选叠加；标签都是小写 slug，最长 255 个字符（标签页 /tags 链接过来）
  const tag = (sp.get('tag') ?? '').trim().toLowerCase().slice(0, 255) || null
  const rawSort = sp.get('sort') as SortKey | null
  const sort: SortKey = rawSort && SORT_KEYS.includes(rawSort) ? rawSort : 'hot'
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
  return { view, category, type, tag, sort, q, page }
}

/** 规范化后的查询串：参数顺序固定，省略默认值；用于链接和 canonical */
export function directorySearch(q: Partial<DirectoryQuery>, { keepSort = true } = {}): string {
  const sp = new URLSearchParams()
  if (q.view) sp.set('view', q.view)
  if (q.category) sp.set('category', q.category)
  if (q.type) sp.set('type', q.type)
  if (q.tag) sp.set('tag', q.tag)
  if (q.q) sp.set('q', q.q)
  if (keepSort && q.sort && q.sort !== 'hot') sp.set('sort', q.sort)
  if (q.page && q.page > 1) sp.set('page', String(q.page))
  return sp.toString()
}
