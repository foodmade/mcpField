import { MagnifyingGlass, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ItemTable, LightLegend } from '../components/ItemTable'
import { PageHeader, useShell } from '../components/Layout'
import { ErrorBox, Loading, Select } from '../components/ui'
import { qs, useApi, type Facets, type ItemPage } from '../lib/api'
import { categoryName } from '../lib/categories'
import { num } from '../lib/format'
import { KIND_LABEL, KINDS, sourceLabel, STAGE_LABEL, STAGES, type Kind } from '../lib/labels'

const ISSUES = [
  { value: '', label: '全部' },
  { value: 'fail', label: '有失败' },
  { value: 'warn', label: '有警告' },
  { value: 'pending', label: '有待处理' },
]
const STAGE_STATES = [
  { value: 'failed', label: '失败' },
  { value: 'pending', label: '待处理' },
  { value: 'warn', label: '警告' },
  { value: 'ok', label: '完成' },
  { value: 'na', label: '不适用' },
]
const SORTS = [
  { value: 'new', label: '最新收录' },
  { value: 'popular', label: '热度' },
  { value: 'name', label: '名称' },
]

export function ItemsPage() {
  const { summary } = useShell()
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') as Kind | null) ?? 'server'
  const get = (k: string) => params.get(k) ?? ''
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      if (!('page' in patch)) p.delete('page')
      return p
    })

  const [q, setQ] = useState(get('q'))
  useEffect(() => setQ(get('q')), [params.get('q')]) // eslint-disable-line react-hooks/exhaustive-deps
  // 输入停顿 400 毫秒后再查
  useEffect(() => {
    const t = setTimeout(() => q.trim() !== get('q') && set({ q: q.trim() || null }), 400)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = qs({ kind, q: get('q'), category: get('category'), source: get('source'), issue: get('issue'), stage: get('stage'), stageState: get('stage') && (get('stageState') || 'failed'), sort: get('sort') || 'new', page: get('page') || 1, pageSize: 20 })
  const { data, error, loading, reload } = useApi<ItemPage>(`/items${query}`)
  const { data: facets } = useApi<Facets>(`/items/facets?kind=${kind}`)
  const today = summary?.daily.at(-1)
  const filters = ['q', 'category', 'source', 'issue', 'stage'].filter((k) => get(k))

  return (
    <>
      <PageHeader title="数据管理" sub={`发布层全部条目 · ${summary ? num(Object.values(summary.totals).reduce((a, b) => a + b, 0)) : '…'}`} onRefresh={reload} />
      <div className="flex flex-col gap-4 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <div className="grid grid-cols-3 gap-2 md:gap-2.5 xl:grid-cols-6">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setParams({ kind: k })}
              className={clsx('flex min-w-0 flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left md:px-4 md:py-3.5', k === kind ? 'border-text3 bg-surface' : 'border-line hover:bg-white/[0.02]')}
            >
              <span className={clsx('truncate text-[13px]', k === kind ? 'font-semibold' : 'text-text2')}>{KIND_LABEL[k]}</span>
              <span className="flex flex-wrap items-end gap-x-2">
                <span className={clsx('text-lg font-semibold tabular md:text-xl', k !== kind && 'text-text2')}>{summary ? num(summary.totals[k]) : '—'}</span>
                <span className={clsx('pb-0.5 text-[11px]', today?.byKind[k] ? 'text-ok' : 'text-text3')}>今日 +{num(today?.byKind[k] ?? 0)}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 sm:w-[280px]">
            <MagnifyingGlass className="size-[15px] text-text3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称、slug、ID" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text3" />
            {q && (
              <button onClick={() => setQ('')} className="text-text3 hover:text-ink" aria-label="清除">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          <Select
            label="分类"
            value={get('category')}
            onChange={(v) => set({ category: v || null })}
            options={[{ value: '', label: '全部分类' }, ...(facets?.categories ?? []).map((c) => ({ value: c.slug, label: `${categoryName(kind, c.slug)}（${num(c.count)}）` }))]}
          />
          <Select label="来源" value={get('source')} onChange={(v) => set({ source: v || null })} options={[{ value: '', label: '全部来源' }, ...(facets?.sources ?? []).map((s) => ({ value: s.id, label: `${sourceLabel(s.id)}（${num(s.count)}）` }))]} />
          <Select label="补全状态" value={get('issue')} onChange={(v) => set({ issue: v || null })} options={ISSUES} highlight={!!get('issue')} />
          <Select label="补全项" value={get('stage')} onChange={(v) => set({ stage: v || null, stageState: v ? get('stageState') || 'failed' : null })} options={[{ value: '', label: '不限' }, ...STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))]} highlight={!!get('stage')} />
          {get('stage') && <Select label="为" value={get('stageState') || 'failed'} onChange={(v) => set({ stageState: v })} options={STAGE_STATES} highlight />}
          <Select label="排序" value={get('sort') || 'new'} onChange={(v) => set({ sort: v === 'new' ? null : v })} options={SORTS} />
          {filters.length > 0 && (
            <button onClick={() => setParams({ kind })} className="text-xs text-text3 hover:text-ink">
              清除筛选
            </button>
          )}
        </div>

        <section className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 md:px-5">
            <span className="text-[13px] font-semibold">
              {KIND_LABEL[kind]} · 符合条件 {data ? num(data.meta.total) : '…'} 条
            </span>
            <LightLegend />
          </div>
          {error && (
            <div className="px-4 pb-5 md:px-5">
              <ErrorBox error={error} retry={reload} />
            </div>
          )}
          {loading && !data ? <Loading /> : data && <ItemTable page={data} onPage={(p) => set({ page: String(p) })} />}
        </section>
      </div>
    </>
  )
}
