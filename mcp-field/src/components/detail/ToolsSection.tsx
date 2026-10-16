import { AnimatePresence, motion } from 'motion/react'
import { ArrowsClockwise, CaretDown, CloudArrowDown, MagnifyingGlass, Warning, Wrench, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { Locale } from '../../i18n/locales'
import type { ApiTool } from '../../lib/api/entities'
import { apiGet } from '../../lib/api/http'
import { daysSince } from '../../lib/entity'
import { parseJson, useStorage } from '../../lib/storage'
import { EmptyState } from './EmptyState'

const PREVIEW = 5
type FetchError = 'auth' | 'network' | 'protocol' | 'unsupported' | 'blocked'

/** 描述按语言翻译，缓存也按语言分开 */
const cacheKey = (slug: string, locale: Locale) => `mcpfield.tools.${locale}.${slug}`

/** 通过后端实时读取远程服务的 tools/list（地址由后端从收录数据中取），本次会话内缓存 */
async function fetchRemoteTools(slug: string, locale: Locale): Promise<{ tools: ApiTool[] } | { error: FetchError }> {
  try {
    const { data } = await apiGet<{ data: { tools?: ApiTool[]; error?: FetchError } }>(`/servers/${encodeURIComponent(slug)}/tools/live`, { locale })
    if (!data.tools) return { error: data.error ?? 'network' }
    return { tools: data.tools }
  } catch {
    return { error: 'network' }
  }
}

function ToolCard({ tool, open, onToggle }: { tool: ApiTool; open: boolean; onToggle: () => void }) {
  const { m } = useI18n()
  return (
    <motion.div
      layout="position"
      className={clsx('rounded-[14px] border transition-colors', open ? 'border-accent/25' : 'border-fg/[0.08] hover:border-fg/15')}
      style={{ background: open ? 'radial-gradient(80% 120% at 0% 0%, #3DDC971A, transparent 60%), var(--color-surface)' : 'var(--color-surface)' }}
    >
      <button onClick={onToggle} aria-expanded={open} className="flex w-full flex-col gap-2.5 px-5 py-4 text-left">
        <span className="flex w-full items-center gap-2.5">
          <span className={clsx('grid size-[26px] place-items-center rounded-[7px] transition-colors', open ? 'bg-accent/15 text-accent' : 'bg-fg/[0.06] text-text2')}>
            <Wrench size={13} />
          </span>
          <span className="flex-1 truncate font-mono text-[15px] font-semibold">{tool.name}</span>
          <CaretDown size={16} className={clsx('shrink-0 text-text2 transition-transform duration-300', open && 'rotate-180')} />
        </span>
        {tool.description && <span className={clsx('whitespace-pre-line text-sm leading-relaxed text-text2', !open && 'line-clamp-2')}>{tool.description}</span>}
        {!open && <span className="text-xs font-medium text-ink">{m.detail.expand}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="px-5 pb-5">
              {tool.params.length ? (
                <div className="overflow-x-auto rounded-[10px] border border-fg/[0.08]">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="bg-fg/[0.03] text-text3">
                      <tr>{(['name', 'type', 'required', 'desc'] as const).map((k) => <th key={k} className="px-3.5 py-2.5 font-normal">{m.detail.params[k]}</th>)}</tr>
                    </thead>
                    <tbody>
                      {tool.params.map((p) => (
                        <tr key={p.path} className="border-t border-fg/[0.06] align-top">
                          <td className="px-3.5 py-2.5 font-mono text-ink">{p.path}</td>
                          <td className="px-3.5 py-2.5 font-mono text-sky">{p.enum ? 'enum' : (p.type ?? 'any')}</td>
                          <td className="px-3.5 py-2.5">
                            <span className={clsx('rounded px-1.5 py-0.5 text-xs', p.required ? 'bg-[#F2994A]/15 text-amber' : 'bg-fg/[0.05] text-text3')}>{p.required ? m.detail.yes : m.detail.no}</span>
                          </td>
                          <td className="px-3.5 py-2.5 text-text2">{p.description}{p.enum && <span className="mt-1 block font-mono text-text3">{p.enum.map(String).join(' | ')}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-text3">{m.detail.noParams}</p>
              )}
              <button onClick={onToggle} className="mt-3 text-xs font-medium text-ink">{m.detail.collapse}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-[14px] border border-fg/[0.06] bg-surface px-5 py-4">
          <div className="h-4 w-48 animate-pulse rounded bg-fg/[0.08]" style={{ animationDelay: `${i * 120}ms` }} />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-fg/[0.05]" style={{ animationDelay: `${i * 120 + 60}ms` }} />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-fg/[0.05]" style={{ animationDelay: `${i * 120 + 90}ms` }} />
        </div>
      ))}
    </div>
  )
}

/** stored：收录时一起采集到的工具列表；storedAt：采集时间 */
type Props = { slug: string; remote: boolean; stored: ApiTool[]; storedAt: string | null }

export function ToolsSection({ slug, remote, stored, storedAt }: Props) {
  const { m, locale } = useI18n()
  // 本次会话读过的实时列表缓存在 sessionStorage；服务端渲染时只有收录的列表（爬虫能看到）
  const [cachedRaw, setCached] = useStorage(cacheKey(slug, locale), 'session')
  const cached = remote ? parseJson<ApiTool[] | null>(cachedRaw, null) : null
  const [fetched, setFetched] = useState<ApiTool[] | null>(null)
  const live = fetched ?? cached
  const [loading, setLoading] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<FetchError | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await fetchRemoteTools(slug, locale)
    if ('tools' in r) {
      setFetched(r.tools)
      setCached(JSON.stringify(r.tools))
    } else setError(r.error)
    setLoading(false)
    setAttempted(true)
  }, [slug, locale, setCached])

  // 远程服务首次进入时自动读取（本次会话已经读过的直接用缓存）
  useEffect(() => {
    if (remote && !sessionStorage.getItem(cacheKey(slug, locale))) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, locale])

  const list = live ?? stored
  // 远程服务还没读到实时列表、也没有收录列表时显示骨架（服务端渲染时也一样，避免先闪出"没有工具"）
  const pending = loading || (remote && !live && !attempted && !error)
  const storedDays = daysSince(storedAt)
  const firstOpen = open ?? list[0]?.name ?? null
  const k = q.trim().toLowerCase()
  const matched = k ? list.filter((t) => t.name.toLowerCase().includes(k)) : list
  const shown = k || all ? matched : matched.slice(0, PREVIEW)
  const source = live ? `${m.detail.live} · ${m.detail.justNow}` : stored.length && storedDays !== null ? m.detail.stored(m.detail.ago(storedDays)) : ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold tracking-tight">{m.detail.tools}</h2>
          {list.length > 0 && <span className="rounded-full bg-fg/10 px-2 py-0.5 tabular-nums text-xs text-text2">{list.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {list.length > PREVIEW && (
            <label className="flex h-[34px] w-[200px] items-center gap-2 rounded-[9px] border border-fg/10 bg-fg/[0.04] px-2.5 focus-within:border-accent/50">
              <MagnifyingGlass size={14} className="shrink-0 text-text3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m.detail.searchTools} aria-label={m.detail.searchTools} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text3" />
              {q && <button onClick={() => setQ('')} aria-label={m.dir.clearSearch} className="text-text3 hover:text-ink"><X size={12} /></button>}
            </label>
          )}
          {remote && (
            <button onClick={load} disabled={loading} className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[9px] border border-fg/15 px-3 text-sm font-medium transition-colors hover:border-fg/30 disabled:opacity-60">
              <ArrowsClockwise size={14} className={loading ? 'animate-spin' : ''} />
              {m.detail.fetchTools}
            </button>
          )}
        </div>
      </div>
      {source && !pending && (
        <p className="flex items-center gap-1.5 text-xs text-text3">
          {live && <CloudArrowDown size={13} className="text-accent" />}
          {source}
        </p>
      )}

      <AnimatePresence>
        {error && !loading && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 rounded-xl border border-[#F2994A]/25 bg-[#F2994A]/[0.08] px-3.5 py-2.5 text-sm text-amber">
            <Warning size={15} className="mt-0.5 shrink-0" />
            <span>{m.detail.err[error]}{stored.length ? ` ${m.detail.showingStored}` : ''}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {pending && list.length === 0 ? (
        <Skeleton />
      ) : !list.length ? (
        <EmptyState icon={Wrench} title={m.detail.noTools} hint={remote ? undefined : m.detail.noToolsLocal} />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {shown.map((t) => (
              <ToolCard key={t.name} tool={t} open={firstOpen === t.name} onToggle={() => setOpen((o) => ((o ?? firstOpen) === t.name ? '' : t.name))} />
            ))}
            {k && !matched.length && <p className="py-8 text-center text-sm text-text3">{m.detail.noMatch(q)}</p>}
          </div>
          {!k && matched.length > PREVIEW && (
            <button onClick={() => setAll((a) => !a)} className="flex h-[42px] items-center justify-center gap-1.5 rounded-xl border border-fg/10 text-sm text-text2 transition-colors hover:border-fg/20 hover:text-ink">
              {all ? m.detail.showLess : m.detail.showAll(matched.length)}
              <CaretDown size={13} className={clsx('transition-transform', all && 'rotate-180')} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
