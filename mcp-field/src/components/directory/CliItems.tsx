import { CheckCircle, Robot, Terminal } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { CliItem } from '../../lib/api/entities'
import { categoryOf } from '../../lib/categories'
import { daysSince } from '../../lib/entity'
import { EntityIcon } from '../EntityIcon'
import { Chip } from '../ui'
import { Tagline } from './ServerItems'

/** 图标右下角的终端角标 */
function CliIcon({ c, size = 44 }: { c: CliItem; size?: number }) {
  const cat = categoryOf('cli', c.category?.slug)
  return (
    <span className="relative shrink-0">
      <EntityIcon name={c.name} src={c.iconUrl} color={cat.color} size={size} />
      <span className="absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-[5px] border border-fg/20 bg-bg text-ink"><Terminal size={11} /></span>
    </span>
  )
}

/** CLI 卡片：图标、名称、简介，底部是分类与 Agent-ready 标识 */
export function CliCard({ c }: { c: CliItem }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('cli', c.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-2.5 p-5">
      <Link to={to(`/cli/${c.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={c.name} />
      <div className="mb-1.5 flex items-start justify-between">
        <CliIcon c={c} />
        {c.official && <span className="flex items-center gap-1 rounded-full border border-fg/15 px-2 py-0.5 text-xs text-text2"><CheckCircle size={12} />{m.cli.official}</span>}
      </div>
      <div className="text-[15px] font-semibold">{c.name}</div>
      <Tagline text={c.tagline} className="line-clamp-2 text-[13px] leading-[1.6]" />
      <div className="mt-auto flex items-center justify-between gap-2">
        <Chip className="truncate">{tr(cat.name)}</Chip>
        {c.agentReady && <span className="flex items-center gap-1 text-xs text-text3"><Robot size={13} />{m.cli.agentReady}</span>}
      </div>
    </SpotlightCard>
  )
}

export function CliRow({ c }: { c: CliItem }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('cli', c.category?.slug)
  const days = daysSince(c.lastCommitAt)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-4">
      <Link to={to(`/cli/${c.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={c.name} />
      <CliIcon c={c} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{c.name}</span>
          {c.official && <CheckCircle size={14} className="shrink-0 text-accent" aria-label={m.cli.official} />}
        </div>
        <Tagline text={c.tagline} className="truncate text-sm" />
      </div>
      <Chip className="hidden md:inline">{tr(cat.name)}</Chip>
      <span className="hidden w-28 shrink-0 text-right text-xs text-text3 sm:block">{days === null ? '' : m.dir.updated(days)}</span>
    </SpotlightCard>
  )
}
