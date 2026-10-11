import { AnimatePresence, motion } from 'motion/react'
import { List, SquaresFour } from '@phosphor-icons/react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import clsx from 'clsx'
import { FaqSection } from '../Faq'
import { Seo } from '../Seo'
import { CountUp } from '../../fx/CountUp'
import { useEnterAnimation } from '../../fx/hydration'
import { useI18n } from '../../i18n/context'
import { stripLocale } from '../../i18n/locales'
import type { Category, TypeOption, ViewKey } from '../../lib/categories'
import { directorySearch } from '../../lib/directoryQuery'
import { absoluteUrl } from '../../lib/seo'
import { EmptyState } from './EmptyState'
import { Pagination } from './Pagination'
import { Sidebar } from './Sidebar'
import { SortMenu } from './SortMenu'
import type { DirectoryParams } from './useDirectoryParams'

export type DirText = {
  title: string
  subBefore: string
  subAfter: string
  searchPh: string
  empty: { searchTitle: (q: string) => string; searchHint: string; catTitle: string; catHint: (c: string) => string; viewAll: string }
}

export type DirCounts = { all: number; byView: Record<ViewKey, number>; byCat: Record<string, number>; byType?: Record<string, number> }

type Props<T extends { slug: string; name: string }> = {
  text: DirText
  categories: Category[]
  views: ViewKey[]
  types?: TypeOption[]
  params: DirectoryParams
  counts: DirCounts
  /** 当前页的条目 */
  items: T[]
  /** 筛选后的总数 */
  total: number
  page: number
  pageSize: number
  /** 条目详情页路径（不带语言前缀），用于结构化数据 */
  itemPath: (item: T) => string
  Card: (p: { item: T }) => ReactNode
  Row: (p: { item: T }) => ReactNode
  /** 站内跳转加载新数据时，列表半透明显示旧数据 */
  loading?: boolean
}

/** 目录页的界面骨架：头部、侧栏、排序与布局切换、列表、分页、FAQ。数据由页面的 loader 提供 */
export function DirectoryLayout<T extends { slug: string; name: string }>({
  text, categories, views, types = [], params: p, counts, items, total, page, pageSize, itemPath, Card, Row, loading = false,
}: Props<T>) {
  const { m, tr, locale } = useI18n()
  const enter = useEnterAnimation()
  const path = stripLocale(useLocation().pathname).rest
  const catBySlug = useMemo(() => Object.fromEntries(categories.map((c) => [c.slug, c])), [categories])
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const listTop = useRef<HTMLDivElement>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const scope = p.view ? m.dir[p.view] : p.category && catBySlug[p.category] ? tr(catBySlug[p.category].name) : null
  const typeLabel = types.find((t) => t.value === p.type)?.label
  const title = [scope, typeLabel].filter(Boolean).join(' · ') || m.dir.all

  // 翻页后若列表顶部已滚出视口，滚回列表开头
  const scrollToList = () => {
    const top = listTop.current?.getBoundingClientRect().top ?? 0
    if (top < 120) window.scrollBy({ top: top - 150, behavior: 'smooth' })
  }

  // SEO：标题和描述带上当前筛选；排序不影响内容，canonical 去掉排序；搜索结果页不收录
  const seoScope = [scope, typeLabel].filter(Boolean).join(' · ')
  const seoTitle = [seoScope, text.title, page > 1 ? m.dir.pageTitle(page) : null, 'MCP Field'].filter(Boolean).join(' · ')
  const seoDesc = `${seoScope ? `${seoScope}：` : ''}${text.subBefore}${(seoScope ? total : counts.all).toLocaleString('en-US')}${text.subAfter}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: seoTitle,
    url: absoluteUrl(locale, path, directorySearch({ ...p, q: '' }, { keepSort: false })),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: total,
      itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: (page - 1) * pageSize + i + 1, name: item.name, url: absoluteUrl(locale, itemPath(item)) })),
    },
  }

  return (
    <>
      <Seo title={seoTitle} description={seoDesc} path={path} query={directorySearch({ ...p, q: '' }, { keepSort: false })} noindex={!!p.q} jsonLd={jsonLd} />
      <section
        className="border-b border-fg/[0.04]"
        style={{ background: 'radial-gradient(60% 220% at 20% 0%, #2B7FFF1F, transparent 60%), radial-gradient(40% 200% at 85% 0%, #3DDC9714, transparent 60%)' }}
      >
        <div className="mx-auto flex max-w-[1248px] flex-wrap items-center justify-between gap-6 px-6 pb-6 pt-7">
          <motion.div key={text.title} initial={enter ? { opacity: 0, y: 14 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
            <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{text.title}</h1>
            <p className="mt-1.5 text-sm text-text2">
              {text.subBefore}
              <CountUp value={counts.all} format={(v) => Math.round(v).toLocaleString('en-US')} className="tabular-nums text-ink" />
              {text.subAfter}
            </p>
          </motion.div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1248px] gap-10 px-6 pb-24 pt-8 lg:grid-cols-[248px_1fr] [&>*]:min-w-0">
        <Sidebar categories={categories} searchPh={text.searchPh} views={views} types={types} counts={counts} p={p} />

        <div ref={listTop} className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={title}
                initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                transition={{ duration: 0.3 }}
                className="text-xl font-bold tracking-tight"
              >
                {title}
              </motion.h2>
            </AnimatePresence>
            <div className="flex items-center gap-2.5">
              <SortMenu value={p.sort} onChange={p.setSort} />
              <div className="flex gap-0.5 rounded-[9px] bg-subtle p-[3px]">
                {([['grid', SquaresFour, m.dir.grid], ['list', List, m.dir.list]] as const).map(([k, I, label]) => (
                  <button key={k} onClick={() => setLayout(k)} aria-label={label} aria-pressed={layout === k} className={clsx('relative grid size-[30px] place-items-center rounded-[7px]', layout === k ? 'text-ink' : 'text-text3 hover:text-ink')}>
                    {layout === k && <motion.span layoutId="layout-pill" className="absolute inset-0 rounded-[7px] bg-fg/10" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                    <I size={15} className="relative" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState kind={p.q ? 'search' : 'category'} label={p.q || title} text={text.empty} onPrimary={() => (p.q ? p.setQuery('') : p.setCategory(null))} />
          ) : (
            <motion.div
              layout
              aria-busy={loading}
              className={clsx(layout === 'grid' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2.5', '[&>*]:min-w-0 transition-opacity duration-200', loading && 'opacity-60')}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {items.map((s, i) => (
                  <motion.div
                    key={`${layout}-${s.slug}`}
                    layout
                    initial={{ opacity: 0, y: 16, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: Math.min(i, 11) * 0.025, type: 'spring', stiffness: 320, damping: 30 } }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                  >
                    {layout === 'grid' ? <Card item={s} /> : <Row item={s} />}
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}

          {total > 0 && items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
              <span className="text-sm text-text3">
                {m.dir.range((page - 1) * pageSize + 1, Math.min(page * pageSize, total), total.toLocaleString('en-US'))}
              </span>
              <Pagination page={page} total={totalPages} to={p.pageTo} onNavigate={scrollToList} />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line">
        <FaqSection />
      </div>
    </>
  )
}
