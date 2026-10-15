import { motion } from 'motion/react'
import { CaretDown, Hash, SortDescending, TextAa, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useFetcher, useLocation, useNavigate, useNavigation, type To } from 'react-router'
import clsx from 'clsx'
import { SearchBox } from '../components/directory/Sidebar'
import { Seo } from '../components/Seo'
import { CountUp } from '../fx/CountUp'
import { useEnterAnimation } from '../fx/hydration'
import { useI18n } from '../i18n/context'
import { stripLocale } from '../i18n/locales'
import type { Kind } from '../lib/api/entities'
import { loadTags } from '../lib/api/loaders'
import type { TagItem, TagList } from '../lib/api/tags'
import { LETTERS, parseTagsQuery, TAG_KINDS, TAG_PAGE_SIZE, tagPath, tagsSearch, type TagsQuery } from '../lib/tagsQuery'
import { absoluteUrl } from '../lib/seo'
import type { Route } from './+types/Tags'

export const loader = (args: Route.LoaderArgs) => loadTags(args)

const fmt = (n: number) => n.toLocaleString('en-US')
const search = (q: Partial<TagsQuery>): To => {
  const s = tagsSearch(q)
  return { search: s ? `?${s}` : '' }
}

/** 数量分三档：≥1,000 用强调色，≥100 用正文色，其余用次要色 */
const TIERS = [
  { min: 1000, pill: 'border-accent/25 bg-accent/[0.07] hover:border-accent/50', name: 'font-semibold text-accent', count: 'bg-accent/15 text-accent' },
  { min: 100, pill: 'border-fg/[0.08] bg-fg/[0.02] hover:border-fg/30 hover:bg-fg/[0.06]', name: 'font-medium text-ink', count: 'bg-fg/[0.05] text-text3' },
  { min: 0, pill: 'border-fg/[0.08] bg-fg/[0.02] hover:border-fg/30 hover:bg-fg/[0.06]', name: 'font-medium text-text2 group-hover:text-ink', count: 'bg-fg/[0.05] text-text3' },
]
const tierOf = (n: number) => TIERS.find((t) => n >= t.min)!

function TagPill({ t, kind }: { t: TagItem; kind: Kind }) {
  const { m, to } = useI18n()
  const tier = tierOf(t.count)
  return (
    <Link to={to(tagPath(kind, t.tag))} title={m.tags.entriesOf(fmt(t.count))} className={clsx('group flex h-[34px] max-w-full items-center gap-2 rounded-[9px] border pl-3 pr-2 transition-colors', tier.pill)}>
      <span className={clsx('truncate text-[13px] transition-colors', tier.name)}>#{t.tag}</span>
      <span className={clsx('rounded-[5px] px-1.5 py-px font-mono text-[11px] tabular-nums', tier.count)}>{fmt(t.count)}</span>
    </Link>
  )
}

/** 分段切换：类型、排序共用 */
function Segment<T extends string>({ label, items, value }: { label: string; items: { key: T; label: string; count?: number; icon?: typeof Hash; to: To }[]; value: T }) {
  return (
    <nav aria-label={label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-subtle p-[3px] [scrollbar-width:none]">
      {items.map((it) => {
        const active = it.key === value
        return (
          <Link key={it.key} to={it.to} preventScrollReset aria-current={active ? 'page' : undefined} className={clsx('relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors', active ? 'font-semibold text-ink' : 'text-text2 hover:text-ink')}>
            {active && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-lg bg-fg/10" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            {it.icon && <it.icon size={14} className={clsx('relative', active ? 'text-ink' : 'text-text3')} />}
            <span className="relative">{it.label}</span>
            {it.count !== undefined && <span className="relative font-mono text-[11px] font-normal tabular-nums text-text3">{fmt(it.count)}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * 「再显示 N 个」：用 fetcher 取下一页接在后面；按钮本身是指向下一页的真实链接，爬虫能顺着翻完全部标签。
 * 筛选条件变了就清空已追加的页。
 */
function usePagedTags(first: TagList, q: TagsQuery) {
  const fetcher = useFetcher<typeof loader>()
  const { pathname } = useLocation()
  const key = tagsSearch({ ...q, page: 1 })
  const [more, setMore] = useState<{ key: string; pages: TagList[] }>({ key, pages: [] })
  if (more.key !== key) setMore({ key, pages: [] })
  const requested = useRef(key)
  const last = more.pages.at(-1)?.meta ?? first.meta

  useEffect(() => {
    const d = fetcher.data
    if (fetcher.state !== 'idle' || !d) return
    setMore((cur) => (cur.key === requested.current && d.meta.page === (cur.pages.at(-1)?.meta ?? first.meta).page + 1 ? { key: cur.key, pages: [...cur.pages, d] } : cur))
  }, [fetcher.data, fetcher.state, first.meta])

  const next = last.page < last.totalPages ? last.page + 1 : null
  return {
    items: [...first.data, ...more.pages.flatMap((p) => p.data)],
    total: last.total,
    next,
    loading: fetcher.state !== 'idle',
    loadNext: () => {
      if (!next) return
      requested.current = key
      fetcher.load(`${pathname}?${tagsSearch({ ...q, page: next })}`)
    },
  }
}

/** 标签页：全部标签按条目数或名称排列，可按类型、关键词、首字母筛选；点击标签进入对应目录页的标签筛选 */
export default function Tags({ loaderData: data }: Route.ComponentProps) {
  const { m, locale } = useI18n()
  const t = m.tags
  const enter = useEnterAnimation()
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const busy = navigation.state === 'loading' && navigation.location.pathname === location.pathname
  const q = parseTagsQuery(new URLSearchParams(location.search))
  const s = data.summary
  const paged = usePagedTags(data, q)
  const start = (data.meta.page - 1) * TAG_PAGE_SIZE
  const remaining = paged.total - start - paged.items.length

  const kinds = TAG_KINDS.filter((k) => (s.kinds[k] ?? 0) > 0 || k === q.kind)
  const letters = LETTERS.filter((l) => l !== 'other' || (s.letters.other ?? 0) > 0)
  const letterLabel = (l: string) => (l === 'other' ? t.letters.other : l === '0-9' ? '0–9' : l.toUpperCase())

  const path = stripLocale(location.pathname).rest
  const canonical = tagsSearch({ ...q, q: '' })
  const title = [q.kind ? t.kinds[q.kind] : null, q.letter ? t.letter(letterLabel(q.letter)) : null, data.meta.page > 1 ? m.dir.pageTitle(data.meta.page) : null, t.seoTitle].filter(Boolean).join(' · ')
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url: absoluteUrl(locale, path, canonical) }

  return (
    <>
      <Seo title={title} description={t.seoDesc(fmt(s.all))} path={path} query={canonical} noindex={!!q.q} jsonLd={jsonLd} />
      <section
        className="relative overflow-hidden border-b border-fg/[0.04]"
        style={{ background: 'radial-gradient(60% 220% at 20% 0%, #2B7FFF1F, transparent 60%), radial-gradient(40% 200% at 85% 0%, #3DDC9714, transparent 60%)' }}
      >
        <motion.div
          initial={enter ? { opacity: 0, y: 14 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto flex max-w-[1248px] flex-wrap items-center justify-between gap-6 px-6 pb-7 pt-9"
        >
          <div>
            <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{t.title}</h1>
            <p className="mt-1.5 max-w-[620px] text-sm text-text2">{t.sub}</p>
          </div>
          <dl className="flex items-center gap-6 sm:gap-9">
            {([[s.tags, t.stats.tags], [s.common, t.stats.common], [s.entries, t.stats.entries]] as const).map(([v, label], i) => (
              <div key={label} className={clsx('flex flex-col-reverse gap-1', i > 0 && 'border-l border-fg/[0.08] pl-6 sm:pl-9')}>
                <dt className="text-xs text-text3">{label}</dt>
                <dd className={clsx('font-mono text-[22px] font-semibold tabular-nums tracking-[-0.02em]', i === 0 ? 'text-accent' : 'text-ink')}>
                  <CountUp value={v} format={(n) => fmt(Math.round(n))} />
                </dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </section>

      <div className="mx-auto flex max-w-[1248px] flex-col gap-5 px-6 pb-24 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="w-full sm:w-[300px]">
              <SearchBox q={q.q} placeholder={t.searchPh} onQuery={(v) => navigate(search({ ...q, q: v, letter: v ? null : q.letter, page: 1 }), { replace: true, preventScrollReset: true })} />
            </div>
            <Segment
              label={t.kindsLabel}
              value={q.kind ?? 'all'}
              items={[
                { key: 'all' as const, label: t.all, count: s.all, to: search({ ...q, kind: null, page: 1 }) },
                ...kinds.map((k) => ({ key: k, label: t.kinds[k], count: s.kinds[k] ?? 0, to: search({ ...q, kind: k, page: 1 }) })),
              ]}
            />
          </div>
          <Segment
            label={t.sortLabel}
            value={q.sort}
            items={[
              { key: 'count' as const, label: t.sorts.count, icon: SortDescending, to: search({ ...q, sort: 'count', page: 1 }) },
              { key: 'name' as const, label: t.sorts.name, icon: TextAa, to: search({ ...q, sort: 'name', page: 1 }) },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[13px] text-text3">
          <span className="flex items-center gap-2">
            {[t.sortedBy[q.sort], paged.total > 0 ? t.range(start + 1, start + paged.items.length, fmt(paged.total)) : null].filter(Boolean).join(' · ')}
            {q.letter && (
              <Link to={search({ ...q, letter: null, page: 1 })} preventScrollReset className="flex h-6 items-center gap-1 rounded-md border border-fg/10 px-2 text-text2 transition-colors hover:border-fg/25 hover:text-ink" aria-label={t.letters.clear}>
                {t.letter(letterLabel(q.letter))}<X size={11} />
              </Link>
            )}
          </span>
          <span className="hidden items-center gap-4 font-mono text-[11px] sm:flex">
            {([['≥ 1,000', 'bg-accent'], ['≥ 100', 'bg-ink'], ['< 100', 'bg-text3']] as const).map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5"><span className={clsx('size-1.5 rounded-full', c)} />{l}</span>
            ))}
          </span>
        </div>

        {paged.items.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-fg/[0.08] px-6 text-center">
            <Hash size={28} className="text-text3" />
            <h2 className="text-lg font-semibold">{t.empty.title(q.q || (q.letter ? letterLabel(q.letter) : ''))}</h2>
            <p className="text-sm text-text2">{t.empty.hint}</p>
            <Link to={search({ kind: q.kind, sort: q.sort })} className="mt-1 flex h-[38px] items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">{t.empty.clear}</Link>
          </div>
        ) : (
          <ul aria-busy={busy} className={clsx('flex flex-wrap gap-2.5 transition-opacity duration-200', busy && 'opacity-60')}>
            {paged.items.map((it) => (
              <li key={it.tag} className="max-w-full">
                <TagPill t={it} kind={q.kind ?? it.kind} />
              </li>
            ))}
          </ul>
        )}

        {paged.next && (
          <div className="flex flex-col items-center gap-2.5 pt-5">
            <Link
              to={search({ ...q, page: paged.next })}
              onClick={(e) => {
                e.preventDefault()
                paged.loadNext()
              }}
              aria-busy={paged.loading}
              className={clsx('flex h-10 items-center gap-2 rounded-[10px] border border-fg/15 bg-fg/[0.03] px-[18px] text-sm font-medium transition-colors hover:border-fg/30 hover:bg-fg/[0.06]', paged.loading && 'pointer-events-none opacity-60')}
            >
              {t.more(Math.min(TAG_PAGE_SIZE, remaining))}
              <CaretDown size={14} className="text-text2" />
            </Link>
            <span className="text-xs text-text3">{t.remaining(fmt(remaining))}</span>
          </div>
        )}

        <section className="mt-6 border-t border-fg/[0.08] pt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{t.letters.title}</h2>
            <p className="text-xs text-text3">{t.letters.hint}</p>
          </div>
          <nav aria-label={t.letters.title} className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1 lg:flex lg:justify-between lg:gap-0">
            {letters.map((l) => {
              const n = s.letters[l] ?? 0
              const active = q.letter === l
              return (
                <Link
                  key={l}
                  to={n > 0 ? search({ kind: q.kind, letter: active ? null : l, sort: active ? q.sort : 'name' }) : search(q)}
                  aria-current={active ? 'page' : undefined}
                  aria-disabled={n === 0}
                  className={clsx(
                    'flex flex-col items-center gap-0.5 rounded-lg py-2 transition-colors lg:w-10',
                    active ? 'bg-accent/15 text-accent' : n > 0 ? 'text-ink hover:bg-fg/[0.06]' : 'pointer-events-none text-text3/50',
                  )}
                >
                  <span className={clsx('font-semibold', l.length > 1 ? 'text-xs leading-[22px]' : 'text-[15px]')}>{letterLabel(l)}</span>
                  <span className={clsx('font-mono text-[10px] tabular-nums', active ? 'text-accent/80' : 'text-text3')}>{fmt(n)}</span>
                </Link>
              )
            })}
          </nav>
        </section>
      </div>
    </>
  )
}
