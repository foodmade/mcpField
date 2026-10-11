import { CheckCircle, CloudArrowUp, Sparkle, Star } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { ServerItem } from '../../lib/api/entities'
import { categoryOf, compactNumber } from '../../lib/categories'
import { daysSince, developerOf } from '../../lib/entity'
import { EntityIcon } from '../EntityIcon'
import { Chip } from '../ui'

function Badges({ s }: { s: ServerItem }) {
  const { m } = useI18n()
  return (
    <>
      {s.verified && <CheckCircle size={14} className="shrink-0 text-accent" aria-label={m.dir.verified} />}
      {s.featured && <Sparkle size={14} weight="fill" className="shrink-0 text-gold" aria-label={m.dir.featured} />}
      {s.isRemote && <CloudArrowUp size={14} className="shrink-0 text-sky" aria-label={m.detail.kind.remote} />}
    </>
  )
}

export function Stars({ n }: { n: number | null }) {
  if (n === null) return null
  return (
    <span className="flex items-center gap-1 tabular-nums text-xs text-text2">
      <Star size={13} weight="fill" className="text-gold" />{compactNumber(n)}
    </span>
  )
}

/** 卡片简介：没有简介时用浅色提示 */
export function Tagline({ text, className }: { text: string | null; className: string }) {
  const { m } = useI18n()
  return <p className={`${className} ${text ? 'text-text2' : 'text-text3'}`}>{text ?? m.client.noTagline}</p>
}

/** 服务卡片：图标、名称与标识、作者、简介，底部只保留星数与分类 */
export function ServerCard({ s }: { s: ServerItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('server', s.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-3 px-[18px] py-4">
      <Link to={to(`/servers/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="flex items-center gap-3">
        <EntityIcon name={s.name} src={s.iconUrl} color={cat.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug"><span className="truncate">{s.name}</span><Badges s={s} /></div>
          <div className="truncate text-xs text-text3">{developerOf(s)}</div>
        </div>
      </div>
      <Tagline text={s.tagline} className="line-clamp-2 min-h-[42px] text-[13px] leading-[1.6]" />
      <div className="mt-auto flex items-center justify-between gap-3">
        <Stars n={s.stars} />
        <Chip className="ml-auto truncate">{tr(cat.name)}</Chip>
      </div>
    </SpotlightCard>
  )
}

export function ServerRow({ s }: { s: ServerItem }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('server', s.category?.slug)
  const days = daysSince(s.lastCommitAt)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-4">
      <Link to={to(`/servers/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <EntityIcon name={s.name} src={s.iconUrl} color={cat.color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{s.name}</span>
          <Badges s={s} />
          <span className="ml-1 truncate text-xs text-text3">{developerOf(s)}</span>
        </div>
        <Tagline text={s.tagline} className="truncate text-[13px]" />
      </div>
      <Chip className="hidden md:inline">{tr(cat.name)}</Chip>
      <span className="hidden w-28 shrink-0 text-right text-xs text-text3 sm:block">{days === null ? '' : m.dir.updated(days)}</span>
      <span className="flex w-14 justify-end"><Stars n={s.stars} /></span>
    </SpotlightCard>
  )
}
