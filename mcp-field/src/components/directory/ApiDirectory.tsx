import { useMemo, type ReactNode } from 'react'
import { useLocation, useNavigation } from 'react-router'
import { ROUTE, type Facets, type ItemOf, type Kind, type PageMeta } from '../../lib/api/entities'
import { PAGE_SIZE, type Category, type TypeOption, type ViewKey } from '../../lib/categories'
import { DEFAULT_VIEWS } from '../../lib/directoryQuery'
import { iconFor } from '../../fx/category3d/catalog'
import { DirectoryLayout, type DirText } from './DirectoryLayout'
import { useDirectoryParams } from './useDirectoryParams'

type Props<K extends Kind> = {
  kind: K
  text: DirText
  categories: Category[]
  /** 侧栏快捷视图，默认精选与已认证 */
  views?: ViewKey[]
  /** 侧栏的子类型筛选（Agent：产品 / 模板）；不传则不显示 */
  types?: TypeOption[]
  /** 只看远程服务（远程服务目录） */
  remote?: boolean
  /** 页面 loader 返回的列表和侧栏计数 */
  data: { list: { data: ItemOf[K][]; meta: PageMeta }; facets: Facets }
  Card: (p: { item: ItemOf[K] }) => ReactNode
  Row: (p: { item: ItemOf[K] }) => ReactNode
}

/**
 * 接口驱动的目录页：数据由页面 loader 在服务端按 URL 参数取回（lib/api/loaders 的 loadDirectory），
 * 这里只负责把计数整理成侧栏需要的结构，并在站内跳转期间标记加载状态。
 */
export function ApiDirectory<K extends Kind>({ kind, text, categories, views = DEFAULT_VIEWS, types = [], remote, data, Card, Row }: Props<K>) {
  const slugs = useMemo(() => new Set(categories.map((c) => c.slug)), [categories])
  const p = useDirectoryParams({ categories, views, types: types.map((t) => t.value) })
  const location = useLocation()
  const navigation = useNavigation()
  const loading = navigation.state === 'loading' && navigation.location.pathname === location.pathname

  const counts = useMemo(() => {
    const f = data.facets
    const byCat: Record<string, number> = {}
    for (const c of f.categories) {
      const slug = c.slug && slugs.has(c.slug) ? c.slug : 'other'
      byCat[slug] = (byCat[slug] ?? 0) + c.count
    }
    const byType = Object.fromEntries(f.types.map((t) => [t.value, t.count]))
    return { all: f.total, byView: f.views, byCat, byType }
  }, [data.facets, slugs])

  // 远程服务目录只显示有条目的分类
  const visible = remote ? categories.filter((c) => (counts.byCat[c.slug] ?? 0) > 0 || c.slug === p.category) : categories
  // 头部显示当前分类的 3D 图标，没选分类时显示这个目录的图标（见 fx/category3d/catalog）
  const icon = iconFor(kind, categories.find((c) => c.slug === p.category))

  return (
    <DirectoryLayout
      text={text}
      categories={visible}
      views={views}
      types={types}
      params={p}
      counts={counts}
      items={data.list.data}
      total={data.list.meta.total}
      page={data.list.meta.page}
      pageSize={PAGE_SIZE}
      itemPath={(item) => `/${ROUTE[kind]}/${item.slug}`}
      Card={Card}
      Row={Row}
      loading={loading}
      icon={icon}
    />
  )
}
