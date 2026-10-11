import { ArrowsClockwise } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { LoopItem } from '../../lib/api/entities'
import { categoryOf } from '../../lib/categories'
import { Chip } from '../ui'
import { Tagline } from './ServerItems'

function LoopIcon({ l }: { l: LoopItem }) {
  const cat = categoryOf('loop', l.category?.slug)
  return <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-fg/10 bg-fg/[0.06]" style={{ color: cat.color }}><cat.icon size={20} /></span>
}

/** Loop 卡片：分类图标、名称、简介，底部是触发方式与最大轮数 */
export function LoopCard({ l }: { l: LoopItem }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('loop', l.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-3 px-[18px] py-4">
      <Link to={to(`/loops/${l.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={l.name} />
      <div className="flex items-center gap-3">
        <LoopIcon l={l} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{l.name}</div>
          <div className="truncate text-xs text-text3">{tr(cat.name)}</div>
        </div>
      </div>
      <Tagline text={l.tagline} className="line-clamp-2 text-[13px] leading-[1.6]" />
      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-text3">
        {l.loopType && <Chip>{m.loop.type[l.loopType] ?? l.loopType}</Chip>}
        {l.maxIterations !== null && <span className="flex items-center gap-1"><ArrowsClockwise size={13} />{m.loop.maxIter(l.maxIterations)}</span>}
      </div>
    </SpotlightCard>
  )
}

export function LoopRow({ l }: { l: LoopItem }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('loop', l.category?.slug)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-4">
      <Link to={to(`/loops/${l.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={l.name} />
      <LoopIcon l={l} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate text-[15px] font-semibold">{l.name}</span><span className="truncate text-xs text-text3">{tr(cat.name)}</span></div>
        <Tagline text={l.tagline} className="truncate text-sm" />
      </div>
      <span className="hidden w-24 shrink-0 text-right text-xs text-text3 sm:block">{l.loopType ? (m.loop.type[l.loopType] ?? l.loopType) : ''}</span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-text3 md:block">{l.maxIterations !== null ? m.loop.maxIter(l.maxIterations) : ''}</span>
    </SpotlightCard>
  )
}
