import { CheckCircle, Sparkle } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { ClientItem } from '../../lib/api/entities'
import { categoryOf } from '../../lib/categories'
import { daysSince, developerOf, domainOf } from '../../lib/entity'
import { EntityIcon } from '../EntityIcon'
import { Chip } from '../ui'
import { Stars, Tagline } from './ServerItems'

function Badges({ c }: { c: ClientItem }) {
  const { m } = useI18n()
  return (
    <>
      {c.verified && <CheckCircle size={14} className="shrink-0 text-accent" aria-label={m.dir.verified} />}
      {c.featured && <Sparkle size={14} weight="fill" className="shrink-0 text-[#F2C94C]" aria-label={m.dir.featured} />}
    </>
  )
}

/** 客户端卡片：图标、名称与标识、域名、简介，底部是星数与分类 */
export function ClientCard({ c }: { c: ClientItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('client', c.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-3 px-[18px] py-4">
      <Link to={to(`/clients/${c.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={c.name} />
      <div className="flex items-center gap-3">
        <EntityIcon name={c.name} src={c.iconUrl} color={cat.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug"><span className="truncate">{c.name}</span><Badges c={c} /></div>
          <div className="truncate text-xs text-text3">{domainOf(c) ?? developerOf(c)}</div>
        </div>
      </div>
      <Tagline text={c.tagline} className="line-clamp-2 min-h-[42px] text-[13px] leading-[1.6]" />
      <div className="mt-auto flex items-center justify-between gap-3">
        <Stars n={c.stars} />
        <Chip className="ml-auto truncate">{tr(cat.name)}</Chip>
      </div>
    </SpotlightCard>
  )
}

export function ClientRow({ c }: { c: ClientItem }) {
  const { tr, to, m } = useI18n()
  const cat = categoryOf('client', c.category?.slug)
  const days = daysSince(c.lastCommitAt)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-4">
      <Link to={to(`/clients/${c.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={c.name} />
      <EntityIcon name={c.name} src={c.iconUrl} color={cat.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{c.name}</span>
          <Badges c={c} />
          <span className="ml-1 truncate text-xs text-text3">{domainOf(c) ?? developerOf(c)}</span>
        </div>
        <Tagline text={c.tagline} className="truncate text-[13px]" />
      </div>
      <Chip className="hidden md:inline">{tr(cat.name)}</Chip>
      <span className="hidden w-28 shrink-0 text-right text-xs text-text3 sm:block">{days === null ? '' : m.dir.updated(days)}</span>
      <span className="flex w-14 justify-end"><Stars n={c.stars} /></span>
    </SpotlightCard>
  )
}
