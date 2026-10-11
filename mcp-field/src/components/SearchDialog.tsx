import { AnimatePresence, motion } from 'motion/react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useI18n } from '../i18n/context'
import type { Locale } from '../i18n/locales'
import { fetchList, ROUTE, type BaseItem, type Kind } from '../lib/api/entities'
import { useApi, useDebounced } from '../lib/api/useApi'
import { categoryOf } from '../lib/categories'
import { EntityIcon } from './EntityIcon'

type SearchType = 'Server' | 'Client' | 'CLI' | 'Loop' | 'Skill' | 'Agent'
type SearchItem = { key: string; type: SearchType; item: BaseItem; color: string; to: string }

const TYPE: Record<Kind, SearchType> = { server: 'Server', client: 'Client', cli: 'CLI', loop: 'Loop', skill: 'Skill', agent: 'Agent' }
/** 每种类型取几条：有关键词时各取前几条，没有关键词时展示各类最热门的 */
const LIMIT: Record<Kind, [query: number, popular: number]> = { server: [5, 3], client: [3, 1], cli: [3, 1], skill: [3, 1], loop: [2, 0], agent: [3, 1] }

/** 在六种类型里并行搜索（后端按名称、简介和译文匹配） */
async function search(q: string, locale: Locale, signal: AbortSignal): Promise<SearchItem[]> {
  const kinds = Object.keys(LIMIT) as Kind[]
  const lists = await Promise.all(
    kinds.map((kind) => {
      const n = LIMIT[kind][q ? 0 : 1]
      return n ? fetchList(kind, { page: 1, pageSize: n, q: q || undefined, sort: 'popular', locale }, signal).then((r) => r.data as BaseItem[]) : Promise.resolve([])
    }),
  )
  return kinds.flatMap((kind, i) =>
    lists[i]!.map((item) => ({ key: `${kind}:${item.slug}`, type: TYPE[kind], item, color: categoryOf(kind, item.category?.slug).color, to: `/${ROUTE[kind]}/${item.slug}` })),
  )
}

const MotionLink = motion.create(Link)

export function useCmdK(toggle: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [toggle])
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { m, to, locale } = useI18n()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const debounced = useDebounced(q.trim(), 200)
  const res = useApi(open ? `search:${locale}:${debounced}` : null, (signal) => search(debounced, locale, signal), { keepPrevious: true })
  const results = useMemo(() => res.data ?? [], [res.data])
  const groups = useMemo(() => {
    const m = new Map<SearchItem['type'], SearchItem[]>()
    results.forEach((r) => m.set(r.type, [...(m.get(r.type) ?? []), r]))
    return [...m.entries()]
  }, [results])

  const change = (v: boolean) => {
    if (!v) setQ('')
    onOpenChange(v)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      const r = results[active]
      if (r) navigate(to(r.to))
      change(false)
    }
  }

  let idx = -1
  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined} onKeyDown={onKey}>
              <motion.div
                className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-fg/10 bg-surface/95 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl"
                initial={{ opacity: 0, scale: 0.94, y: -12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <Dialog.Title className="sr-only">{m.search.title}</Dialog.Title>
                <div className="flex items-center gap-3 border-b border-fg/[0.08] px-5">
                  <MagnifyingGlass size={18} className="text-text3" />
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setActive(0)
                    }}
                    placeholder={m.search.placeholder}
                    className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text3"
                  />
                  <kbd className="rounded-[5px] border border-fg/10 px-1.5 py-0.5 font-mono text-xs text-text3">ESC</kbd>
                </div>
                <div className="max-h-[min(440px,60vh)] overflow-y-auto p-2">
                  {!q && <div className="px-3 pb-1 pt-2 text-xs text-text3">{m.search.popular}</div>}
                  <motion.div key={q} initial="h" animate="s" variants={{ h: {}, s: { transition: { staggerChildren: 0.025 } } }}>
                    {groups.map(([type, items]) => (
                      <div key={type} className="mb-1">
                        {q && <div className="px-3 pb-1 pt-2 text-xs text-text3">{m.search.types[type]}</div>}
                        {items.map((r) => {
                          idx++
                          const me = idx
                          return (
                            <MotionLink
                              to={to(r.to)}
                              key={r.key}
                              variants={{ h: { opacity: 0, x: -8 }, s: { opacity: 1, x: 0 } }}
                              onMouseEnter={() => setActive(me)}
                              onClick={() => change(false)}
                              className="relative flex items-center gap-3 rounded-lg px-3 py-2.5"
                            >
                              {active === me && <motion.span layoutId="search-hl" className="absolute inset-0 rounded-lg bg-fg/[0.07]" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                              <EntityIcon name={r.item.name} src={r.item.iconUrl} color={r.color} size={32} className="relative" />
                              <span className="relative min-w-0 flex-1">
                                <span className="block truncate text-sm">{r.item.name}</span>
                                {r.item.tagline && <span className="block truncate text-xs text-text3">{r.item.tagline}</span>}
                              </span>
                              <span className="relative rounded border border-fg/10 px-1.5  text-xs text-text2">{r.type}</span>
                            </MotionLink>
                          )
                        })}
                      </div>
                    ))}
                  </motion.div>
                  {!results.length && !res.loading && (
                    <div className="px-3 py-12 text-center">
                      <div className="text-sm text-ink">{m.search.empty(q)}</div>
                      <div className="mt-1 text-xs text-text3">{m.search.emptyHint}</div>
                    </div>
                  )}
                </div>
                {q && results.length > 0 && (
                  <Link to={to(`/servers?q=${encodeURIComponent(q)}`)} onClick={() => change(false)} className="group flex items-center justify-between border-t border-fg/[0.08] px-5 py-3 text-sm text-text2 hover:text-ink">
                    {m.search.all(q)}
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                  </Link>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
