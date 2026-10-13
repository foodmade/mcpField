import { AnimatePresence, motion } from 'motion/react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, CircleNotch, MagnifyingGlass } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useI18n } from '../i18n/context'
import type { Locale } from '../i18n/locales'
import { fetchList, ROUTE, type BaseItem, type Kind } from '../lib/api/entities'
import { useDebounced } from '../lib/api/useApi'
import { categoryOf } from '../lib/categories'
import { EntityIcon } from './EntityIcon'

type SearchType = 'Server' | 'Client' | 'CLI' | 'Loop' | 'Skill' | 'Agent'
type SearchItem = { key: string; type: SearchType; item: BaseItem; color: string; to: string }
type Group = { kind: Kind; items: SearchItem[]; stale: boolean }

const TYPE: Record<Kind, SearchType> = { server: 'Server', client: 'Client', cli: 'CLI', loop: 'Loop', skill: 'Skill', agent: 'Agent' }
/** 每种类型取几条：有关键词时各取前几条，没有关键词时展示各类最热门的 */
const LIMIT: Record<Kind, [query: number, popular: number]> = { server: [5, 3], client: [3, 1], cli: [3, 1], skill: [3, 1], loop: [2, 0], agent: [3, 1] }

const KINDS = Object.keys(LIMIT) as Kind[]

const toItem = (kind: Kind, item: BaseItem): SearchItem => ({ key: `${kind}:${item.slug}`, type: TYPE[kind], item, color: categoryOf(kind, item.category?.slug).color, to: `/${ROUTE[kind]}/${item.slug}` })

/**
 * 在六种类型里并行搜索（后端按名称、简介和译文匹配）。每类各自落地：快的先显示，不等最慢的那类；
 * 某类的新结果回来之前继续显示它上一次的结果并标记 stale（界面上压暗），分组不会忽有忽无地跳动。
 */
function useSearch(q: string, locale: Locale, enabled: boolean): Group[] {
  const key = enabled ? `${locale}:${q}` : null
  const [byKind, setByKind] = useState<Partial<Record<Kind, { key: string; items: SearchItem[] }>>>({})

  useEffect(() => {
    if (key === null) return
    const ctrl = new AbortController()
    const settle = (kind: Kind, items: SearchItem[]) => {
      if (!ctrl.signal.aborted) setByKind((s) => ({ ...s, [kind]: { key, items } }))
    }
    for (const kind of KINDS) {
      const n = LIMIT[kind][q ? 0 : 1]
      if (!n) continue
      fetchList(kind, { page: 1, pageSize: n, q: q || undefined, sort: 'popular', locale, withTotal: false }, ctrl.signal).then(
        (r) => settle(kind, (r.data as BaseItem[]).map((item) => toItem(kind, item))),
        // 某一类失败只当它没有结果，不拖累其它类
        () => settle(kind, []),
      )
    }
    return () => ctrl.abort()
  }, [key, q, locale])

  return KINDS.map((kind) => {
    if (!LIMIT[kind][q ? 0 : 1]) return { kind, items: [], stale: false }
    const r = byKind[kind]
    return { kind, items: r?.items ?? [], stale: r?.key !== key }
  })
}

const MotionLink = motion.create(Link)

/** 还没有任何结果可展示时（首次打开、上一次搜索为空）的占位行，尺寸贴近真实结果行 */
const RowSkeleton = () => (
  <>
    {[42, 58, 34, 50].map((w, i) => (
      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
        <span className="size-8 shrink-0 animate-pulse rounded-lg bg-fg/[0.06]" style={{ animationDelay: `${i * 100}ms` }} />
        <span className="flex-1 space-y-2">
          <span className="block h-3.5 animate-pulse rounded bg-fg/[0.06]" style={{ width: `${w}%`, animationDelay: `${i * 100}ms` }} />
          <span className="block h-3 w-3/4 animate-pulse rounded bg-fg/[0.04]" style={{ animationDelay: `${i * 100 + 50}ms` }} />
        </span>
      </div>
    ))}
  </>
)

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
  // 按 key 记选中项：各类结果陆续到达会在前面插入行，按下标记会让选中项悄悄变成别的条目
  const [active, setActive] = useState<string | null>(null)
  const debounced = useDebounced(q.trim(), 200)
  // 防抖等待期间也算搜索中：一输入就给反馈，而不是等请求发出去才有变化
  const typing = q.trim() !== debounced
  const lists = useSearch(debounced, locale, open)
  const pending = typing || lists.some((g) => g.stale)
  const groups = lists.filter((g) => g.items.length)
  const results = groups.flatMap((g) => g.items)

  const change = (v: boolean) => {
    if (!v) {
      setQ('')
      setActive(null)
    }
    onOpenChange(v)
  }

  const onKey = (e: React.KeyboardEvent) => {
    // 输入法组字时的方向键 / 回车是在选候选词，不处理
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = results.findIndex((r) => r.key === active)
      setActive(results[e.key === 'ArrowDown' ? Math.min(i + 1, results.length - 1) : Math.max(i - 1, 0)]?.key ?? null)
    } else if (e.key === 'Enter') {
      // 只打开用方向键 / 鼠标明确选中的那一条；没选中时回车不跳转，避免输完关键词一回车就进了第一条的详情页
      const r = results.find((r) => r.key === active)
      if (!r) return
      navigate(to(r.to))
      change(false)
    }
  }

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
                  {pending ? <CircleNotch size={18} className="animate-spin text-text3" /> : <MagnifyingGlass size={18} className="text-text3" />}
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setActive(null)
                    }}
                    placeholder={m.search.placeholder}
                    className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-text3"
                  />
                  <kbd className="rounded-[5px] border border-fg/10 px-1.5 py-0.5 font-mono text-xs text-text3">ESC</kbd>
                </div>
                <div className="max-h-[min(440px,60vh)] overflow-y-auto p-2" aria-busy={pending}>
                  {!q && <div className="px-3 pb-1 pt-2 text-xs text-text3">{m.search.popular}</div>}
                  {!results.length && pending && <RowSkeleton />}
                  {/* 每类按自己的结果集重新挂载：这一类的新结果到达时才重播入场动画；还在搜索中的类压暗显示上一次的结果 */}
                  {groups.map(({ kind, items, stale }) => (
                    <motion.div
                      key={items.map((r) => r.key).join()}
                      initial="h"
                      animate="s"
                      variants={{ h: {}, s: { transition: { staggerChildren: 0.025 } } }}
                      className={clsx('mb-1 transition-opacity duration-200', (typing || stale) && 'opacity-60')}
                    >
                      {q && <div className="px-3 pb-1 pt-2 text-xs text-text3">{m.search.types[TYPE[kind]]}</div>}
                      {items.map((r) => (
                        <MotionLink
                          to={to(r.to)}
                          key={r.key}
                          variants={{ h: { opacity: 0, x: -8 }, s: { opacity: 1, x: 0 } }}
                          onMouseEnter={() => setActive(r.key)}
                          onClick={() => change(false)}
                          className="relative flex items-center gap-3 rounded-lg px-3 py-2.5"
                        >
                          {active === r.key && <motion.span layoutId="search-hl" className="absolute inset-0 rounded-lg bg-fg/[0.07]" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                          <EntityIcon name={r.item.name} src={r.item.iconUrl} color={r.color} size={32} className="relative" />
                          <span className="relative min-w-0 flex-1">
                            <span className="block truncate text-sm">{r.item.name}</span>
                            {r.item.tagline && <span className="block truncate text-xs text-text3">{r.item.tagline}</span>}
                          </span>
                          <span className="relative rounded border border-fg/10 px-1.5  text-xs text-text2">{r.type}</span>
                        </MotionLink>
                      ))}
                    </motion.div>
                  ))}
                  {!results.length && !pending && (
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
