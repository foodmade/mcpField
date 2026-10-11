import { CheckCircle, DownloadSimple } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import type { SkillItem } from '../../lib/api/entities'
import { categoryOf, compactNumber } from '../../lib/categories'
import { repoPath } from '../../lib/entity'
import { Chip } from '../ui'
import { Tagline } from './ServerItems'

function Official() {
  const { m } = useI18n()
  return <span className="flex shrink-0 items-center gap-1 rounded-full border border-fg/15 px-2 py-0.5 text-[11px] text-text2"><CheckCircle size={12} />{m.dir.official}</span>
}

const Installs = ({ n }: { n: number | null }) =>
  n === null ? null : <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-text3"><DownloadSimple size={12} />{compactNumber(n)}</span>

/** Skill 卡片：无图标，名称 + 官方标识、仓库、三行简介、分类与安装数 */
export function SkillCard({ s }: { s: SkillItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full flex-col gap-2 px-[18px] py-4">
      <Link to={to(`/skills/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[15px] font-semibold">{s.name}</span>
        {s.official && <Official />}
      </div>
      <div className="truncate text-xs text-text3">{repoPath(s.links.repository)?.replace('/', ' / ')}</div>
      <Tagline text={s.tagline} className="line-clamp-3 text-[13px] leading-[1.6]" />
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <Chip className="truncate">{tr(cat.name)}</Chip>
        <Installs n={s.installs} />
      </div>
    </SpotlightCard>
  )
}

export function SkillRow({ s }: { s: SkillItem }) {
  const { tr, to } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex items-center gap-4 px-5 py-3.5">
      <Link to={to(`/skills/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{s.name}</span>
          {s.official && <Official />}
          <span className="truncate text-xs text-text3">{repoPath(s.links.repository)}</span>
        </div>
        <Tagline text={s.tagline} className="truncate text-[13px]" />
      </div>
      <Chip className="hidden md:inline">{tr(cat.name)}</Chip>
      <span className="hidden w-16 justify-end sm:flex"><Installs n={s.installs} /></span>
    </SpotlightCard>
  )
}
