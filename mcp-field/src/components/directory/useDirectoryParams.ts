import { useSearchParams, type To } from 'react-router'
import { directorySearch, parseDirectoryQuery, type DirectoryConfig, type DirectoryQuery } from '../../lib/directoryQuery'
import type { SortKey, ViewKey } from '../../lib/categories'

/**
 * 目录状态全部保存在 URL：刷新、复制链接、前进后退都能还原，爬虫也能顺着链接抓取各分类和分页。
 * 解析规则与服务端 loader 共用（lib/directoryQuery）。
 */
export function useDirectoryParams(config: DirectoryConfig) {
  const [sp, setSp] = useSearchParams()
  const q = parseDirectoryQuery(sp, config)

  /** 在当前状态上修改后的链接目标；除了翻页，修改筛选都回到第 1 页 */
  const to = (patch: Partial<DirectoryQuery>): To => {
    const s = directorySearch({ ...q, page: 1, ...patch })
    return { search: s ? `?${s}` : '' }
  }
  const go = (patch: Partial<DirectoryQuery>, replace = false) =>
    setSp(new URLSearchParams(directorySearch({ ...q, page: 1, ...patch })), { replace, preventScrollReset: true })

  return {
    ...q,
    to,
    // 快捷视图与分类互斥；子类型可以和它们叠加，再次点击取消
    viewTo: (v: ViewKey) => to({ view: v, category: null }),
    categoryTo: (c: string | null) => to({ category: c, view: null }),
    typeTo: (t: string) => to({ type: t === q.type ? null : t }),
    pageTo: (p: number) => to({ page: p }),
    tagTo: (t: string | null) => to({ tag: t }),
    setCategory: (c: string | null) => go({ category: c, view: null }),
    setTag: (t: string | null) => go({ tag: t }),
    setSort: (s: SortKey) => go({ sort: s }),
    setQuery: (v: string) => go({ q: v }, true),
  }
}

export type DirectoryParams = ReturnType<typeof useDirectoryParams>
