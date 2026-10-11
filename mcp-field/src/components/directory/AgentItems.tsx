import { CheckCircle, Sparkle } from '@phosphor-icons/react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { AgentItem } from '../../lib/api/entities'
import { categoryOf } from '../../lib/categories'
import { developerOf, domainOf } from '../../lib/entity'
import { EntityIcon } from '../EntityIcon'
import { Chip } from '../ui'
import { Tagline } from './ServerItems'

function Badges({ a }: { a: AgentItem }) {
  const { m } = useI18n()
  return (
    <>
      {a.verified && <CheckCircle size={14} className="shrink-0 text-accent" aria-label={m.dir.verified} />}
      {a.featured && <Sparkle size={14} weight="fill" className="shrink-0 text-[#F2C94C]" aria-label={m.dir.featured} />}
    </>
  )
}

/** 子类型标签：产品是中性色，模板是紫色 */
export function AgentTypeTag({ type, className }: { type: string | null; className?: string }) {
  const { m } = useI18n()
  if (!type) return null
  return (
    <span
      className={clsx(
        'shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]',
        type === 'template' ? 'border-[#A78BFA]/30 bg-[#A78BFA]/10 text-[#C4B5FD]' : 'border-white/15 text-text2',
        className,
      )}
    >
      {m.agent.type[type] ?? type}
    </span>
  )
}

/** Agent 卡片：图标、名称与标识、开发方、右上角子类型，简介，底部标签（放不下的整行隐藏） */
export function AgentCard({ a }: { a: AgentItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('agent', a.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-3 px-[18px] py-4">
      <Link to={to(`/agents/${a.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={a.name} />
      <div className="flex items-center gap-3">
        <EntityIcon name={a.name} src={a.iconUrl} color={cat.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug"><span className="truncate">{a.name}</span><Badges a={a} /></div>
          <div className="truncate text-xs text-text3">{developerOf(a) ?? domainOf(a)}</div>
        </div>
        <AgentTypeTag type={a.agentType} className="self-start" />
      </div>
      <Tagline text={a.tagline} className="line-clamp-2 min-h-[42px] text-[13px] leading-[1.6]" />
      <div className="mt-auto flex h-[22px] flex-wrap gap-1.5 overflow-hidden">
        {a.tags.length > 0
          ? a.tags.slice(0, 3).map((t) => <Chip key={t} className="font-mono leading-4 text-text3">#{t}</Chip>)
          : <Chip className="leading-4">{tr(cat.name)}</Chip>}
      </div>
    </SpotlightCard>
  )
}

export function AgentRow({ a }: { a: AgentItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('agent', a.category?.slug)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-4">
      <Link to={to(`/agents/${a.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={a.name} />
      <EntityIcon name={a.name} src={a.iconUrl} color={cat.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{a.name}</span>
          <Badges a={a} />
          <span className="ml-1 truncate text-xs text-text3">{developerOf(a) ?? domainOf(a)}</span>
        </div>
        <Tagline text={a.tagline} className="truncate text-[13px]" />
      </div>
      <Chip className="hidden md:inline">{tr(cat.name)}</Chip>
      <span className="hidden w-[72px] justify-end sm:flex"><AgentTypeTag type={a.agentType} /></span>
    </SpotlightCard>
  )
}
