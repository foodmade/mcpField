import { motion } from 'motion/react'
import { CaretDown, CheckCircle, MagnifyingGlass, ShieldCheck, SquaresFour, Star, X } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, type To } from 'react-router'
import clsx from 'clsx'
import { useEnterAnimation } from '../../fx/hydration'
import { useI18n } from '../../i18n/context'
import type { Category, TypeOption, ViewKey } from '../../lib/categories'
import type { DirCounts } from './DirectoryLayout'
import type { DirectoryParams } from './useDirectoryParams'

const COLLAPSED = 10
const VIEW_ICON: Record<ViewKey, [typeof Star, string]> = { official: [ShieldCheck, '#9FC6FF'], featured: [Star, '#F2C94C'], verified: [CheckCircle, '#3DDC97'] }

type Props = {
  categories: Category[]
  searchPh: string
  views: ViewKey[]
  types: TypeOption[]
  counts: DirCounts
  p: DirectoryParams
}

/** 侧栏项都是真实链接（?category=…），爬虫可以进入各分类页 */
function Item({ active, icon, label, count, to, accent }: { active: boolean; icon: ReactNode; label: string; count: number; to: To; accent?: string }) {
  return (
    <Link
      to={to}
      preventScrollReset
      aria-current={active ? 'page' : undefined}
      className={clsx('group relative flex h-[38px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-sm transition-colors', active ? 'font-semibold text-ink' : 'text-text2 hover:bg-white/[0.04] hover:text-ink')}
    >
      {active && (
        <motion.span
          layoutId="dir-active"
          className="absolute inset-0 rounded-[9px] border border-accent/20"
          style={{ background: 'linear-gradient(90deg, rgba(61,220,151,0.15), rgba(255,255,255,0.04))' }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span className="relative transition-transform duration-300 group-hover:scale-110" style={{ color: active ? '#3DDC97' : accent }}>{icon}</span>
      <span className="relative flex-1 truncate">{label}</span>
      <span className={clsx('relative tabular-nums text-xs', active ? 'text-accent' : 'text-text3')}>{count.toLocaleString('en-US')}</span>
    </Link>
  )
}

/** 子类型项：可以和视图、分类同时选中，所以不用共享的选中动画，而是用描边表示 */
function TypeItem({ active, icon, label, count, to, accent }: { active: boolean; icon: ReactNode; label: string; count: number; to: To; accent: string }) {
  return (
    <Link
      to={to}
      preventScrollReset
      aria-pressed={active}
      className={clsx(
        'group flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border px-2.5 text-left text-sm transition-colors',
        active ? 'border-white/15 bg-white/[0.06] font-semibold text-ink' : 'border-transparent text-text2 hover:bg-white/[0.04] hover:text-ink',
      )}
    >
      <span className="transition-transform duration-300 group-hover:scale-110" style={{ color: accent }}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {active ? <X size={12} className="text-text3" /> : <span className="tabular-nums text-xs text-text3">{count.toLocaleString('en-US')}</span>}
    </Link>
  )
}

/** 搜索框：输入停顿 300ms 后才更新 URL（触发重新加载），回车立即搜索 */
function SearchBox({ q, onQuery, placeholder }: { q: string; onQuery: (v: string) => void; placeholder: string }) {
  const { m } = useI18n()
  const [text, setText] = useState(q)
  // 最近一次提交的关键词；URL 追上它之前不要用旧值覆盖正在输入的内容
  const [sent, setSent] = useState(q)
  const [synced, setSynced] = useState(q)
  if (q !== synced) {
    setSynced(q)
    if (q !== sent) {
      setText(q)
      setSent(q)
    }
  }
  const submit = (v: string) => {
    setSent(v)
    onQuery(v)
  }
  useEffect(() => {
    const v = text.trim()
    if (v === sent) return
    const id = setTimeout(() => submit(v), 300)
    return () => clearTimeout(id)
  })
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        submit(text.trim())
      }}
      className="flex h-[38px] items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.04] px-3 transition-colors focus-within:border-accent/50 focus-within:bg-white/[0.06]"
    >
      <MagnifyingGlass size={15} className="shrink-0 text-text3" />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text3 [&::-webkit-search-cancel-button]:hidden" />
      {text && (
        <button
          type="button"
          onClick={() => {
            setText('')
            submit('')
          }}
          aria-label={m.dir.clearSearch}
          className="text-text3 hover:text-ink"
        >
          <X size={13} />
        </button>
      )}
    </form>
  )
}

function CategoryItem({ c, p, count }: { c: Category; p: DirectoryParams; count: number }) {
  const { tr } = useI18n()
  const enter = useEnterAnimation()
  return (
    <motion.div initial={enter ? { opacity: 0, x: -6 } : false} animate={{ opacity: 1, x: 0 }}>
      <Item active={p.category === c.slug} icon={<c.icon size={16} />} accent={c.color} label={tr(c.name)} count={count} to={p.categoryTo(c.slug)} />
    </motion.div>
  )
}

export function Sidebar({ categories: allCategories, searchPh, views, types, counts, p }: Props) {
  const { m, tr } = useI18n()
  const activeIdx = allCategories.findIndex((c) => c.slug === p.category)
  const [expanded, setExpanded] = useState(false)
  const showAll = expanded || activeIdx >= COLLAPSED
  const cats = showAll ? allCategories : allCategories.slice(0, COLLAPSED)

  const chips: { key: string; label: string; active: boolean; to: To }[] = [
    { key: 'all', label: `${m.dir.all} ${counts.all}`, active: !p.view && !p.category, to: p.categoryTo(null) },
    ...views.map((v) => ({ key: v, label: `${m.dir[v]} ${counts.byView[v]}`, active: p.view === v, to: p.viewTo(v) })),
    ...types.map((t) => ({ key: `type:${t.value}`, label: `${t.label} ${counts.byType?.[t.value] ?? 0}`, active: p.type === t.value, to: p.typeTo(t.value) })),
    ...allCategories.map((c) => ({ key: c.slug, label: `${tr(c.name)} ${counts.byCat[c.slug] ?? 0}`, active: p.category === c.slug, to: p.categoryTo(c.slug) })),
  ]

  const search = <SearchBox q={p.q} onQuery={p.setQuery} placeholder={searchPh} />

  return (
    <>
      <div className="flex flex-col gap-3 lg:hidden">
        {search}
        <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none]">
          {chips.map((c) => (
            <Link key={c.key} to={c.to} preventScrollReset className={clsx('shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors', c.active ? 'border-accent/40 bg-accent/15 font-medium text-[#9FF0CB]' : 'border-white/10 text-text2')}>
              {c.label}
            </Link>
          ))}
        </div>
      </div>
      <aside className="hidden flex-col gap-7 lg:flex lg:sticky lg:top-[132px] lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pb-6 [scrollbar-width:none]">
        {search}

        <div>
          <GroupTitle>{m.dir.views}</GroupTitle>
          {views.map((v) => {
            const [Icon, accent] = VIEW_ICON[v]
            return <Item key={v} active={p.view === v} icon={<Icon size={16} weight={v === 'featured' ? 'fill' : 'regular'} />} accent={accent} label={m.dir[v]} count={counts.byView[v]} to={p.viewTo(v)} />
          })}
        </div>

        {types.length > 0 && (
          <div>
            <GroupTitle>{m.agent.typeGroup}</GroupTitle>
            {types.map((t) => (
              <TypeItem key={t.value} active={p.type === t.value} icon={<t.icon size={16} />} accent={t.color} label={t.label} count={counts.byType?.[t.value] ?? 0} to={p.typeTo(t.value)} />
            ))}
          </div>
        )}

        <div>
          <GroupTitle>{m.dir.categories}</GroupTitle>
          <Item active={!p.view && !p.category} icon={<SquaresFour size={16} />} label={m.dir.all} count={counts.all} to={p.categoryTo(null)} />
          {cats.map((c) => <CategoryItem key={c.slug} c={c} p={p} count={counts.byCat[c.slug] ?? 0} />)}
          {activeIdx < COLLAPSED && allCategories.length > COLLAPSED && (
            <button onClick={() => setExpanded((e) => !e)} className="mt-1 flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-text2 hover:text-ink">
              {expanded ? m.dir.collapse : m.dir.expand(allCategories.length)}
              <CaretDown size={12} className={clsx('transition-transform duration-300', expanded && 'rotate-180')} />
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-text3">{children}</div>
}
