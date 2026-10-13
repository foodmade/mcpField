import { AnimatePresence, motion } from 'motion/react'
import { ArrowsClockwise, Check, CheckCircle, Copy, DownloadSimple } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CountUp } from '../fx/CountUp'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { SpotlightCard } from '../fx/SpotlightCard'
import { useI18n } from '../i18n/context'
import type { ClientItem, CliItem, ItemOf, LoopItem, ServerDetail, ServerItem, SkillItem } from '../lib/api/entities'
import { categoryOf } from '../lib/categories'
import { serverCommand } from '../lib/config'
import { developerOf, domainOf, repoPath } from '../lib/entity'
import { EntityIcon } from './EntityIcon'
import { ServerCard, Stars, Tagline } from './directory/ServerItems'
import { Chip, LinkArrow, SectionHeader } from './ui'

/** 面板：精选区里"一组条目放在同一块底板上"的容器 */
const panel = 'overflow-hidden rounded-[18px] border border-fg/[0.08] bg-surface'

function CopyCommand({ cmd }: { cmd: string }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
    } catch {
      /* 剪贴板不可用时仍给出反馈 */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <button onClick={copy} aria-label={m.featured.copy} className="relative z-20 flex w-full items-center justify-between gap-2 rounded-lg border border-fg/[0.08] bg-fg/[0.04] px-2.5 py-[7px] text-left transition-colors hover:border-fg/20">
      <span className="truncate font-mono text-xs text-text2">{cmd}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(copied)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className={copied ? 'flex items-center gap-1 text-xs text-accent' : 'text-text3'}>
          {copied ? <><Check size={13} weight="bold" />{m.featured.copied}</> : <Copy size={13} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** 精选服务大卡：本周推荐的第一个，带 AI 导读、接入命令和工具名 */
function SpotlightServer({ s, d }: { s: ServerItem; d: ServerDetail | null }) {
  const { m, tr, to } = useI18n()
  const cat = categoryOf('server', s.category?.slug)
  const cmd = d ? serverCommand(d) : null
  const tools = d?.tools ?? []
  return (
    <SpotlightCard glow={cat.color} lift={false} className="flex h-full flex-col gap-4 p-7">
      <Link to={to(`/servers/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="flex items-center gap-3.5">
        <EntityIcon name={s.name} src={s.iconUrl} color={cat.color} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[22px] font-semibold leading-tight"><span className="truncate">{s.name}</span>{s.verified && <CheckCircle size={17} className="shrink-0 text-accent" />}</div>
          <div className="truncate text-[13px] text-text3">{[developerOf(s), m.featured.spotlight].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <p className="line-clamp-3 text-sm leading-[1.7] text-text2">{d?.overview?.summary ?? s.tagline ?? m.client.noTagline}</p>
      {cmd && <CopyCommand cmd={cmd} />}
      {tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text3">{m.featured.toolsCount(d?.toolsCount ?? tools.length)}</span>
          {tools.slice(0, 4).map((t) => (
            <span key={t.name} className="rounded-md border border-accent/20 bg-accent/[0.08] px-2 py-0.5 font-mono text-[11.5px] text-mint">{t.name}</span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <Chip>{tr(cat.name)}</Chip>
          <Chip>{s.isRemote ? m.featured.remote : m.featured.local}</Chip>
        </div>
        <Stars n={s.stars} />
      </div>
    </SpotlightCard>
  )
}

/** 精选 MCP 服务：一大四小的拼贴，第一个推荐展开讲 */
function ServerBento({ items, spotlight }: { items: ServerItem[]; spotlight: ServerDetail | null }) {
  const [first, ...rest] = items
  if (!first) return null
  return (
    <RevealGroup className="grid gap-3 lg:grid-cols-[588px_1fr] [&>*]:min-w-0">
      <RevealItem><SpotlightServer s={first} d={spotlight} /></RevealItem>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        {rest.slice(0, 4).map((s) => <RevealItem key={s.slug}><ServerCard s={s} /></RevealItem>)}
      </div>
    </RevealGroup>
  )
}

/** 列表面板里的一行：图标、名称与副标题、一句话简介，右侧标签 */
function PanelRow({ href, icon, name, sub, mono, badge, tagline, chip }: { href: string; icon: ReactNode; name: string; sub: string | null; mono?: boolean; badge?: ReactNode; tagline: string | null; chip: string }) {
  const { to } = useI18n()
  return (
    <Link to={to(href)} className="group flex items-center gap-3.5 border-t border-fg/[0.06] px-[22px] py-[18px] transition-colors first:border-t-0 hover:bg-fg/[0.025]">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold transition-colors group-hover:text-accent">{name}</span>
          {sub && <span className={mono ? 'shrink-0 font-mono text-xs text-text3' : 'truncate text-xs text-text3'}>{sub}</span>}
          {badge}
        </div>
        <Tagline text={tagline} className="mt-0.5 truncate text-[13px]" />
      </div>
      <Chip className="hidden shrink-0 sm:inline">{chip}</Chip>
    </Link>
  )
}

function ClientPanel({ items }: { items: ClientItem[] }) {
  const { tr } = useI18n()
  return (
    <div className={panel}>
      {items.map((c) => {
        const cat = categoryOf('client', c.category?.slug)
        return <PanelRow key={c.slug} href={`/clients/${c.slug}`} icon={<EntityIcon name={c.name} src={c.iconUrl} color={cat.color} />} name={c.name} sub={domainOf(c) ?? developerOf(c)} tagline={c.tagline} chip={tr(cat.name)} />
      })}
    </div>
  )
}

function CliPanel({ items }: { items: CliItem[] }) {
  const { m, tr } = useI18n()
  return (
    <div className={panel}>
      {items.map((c) => {
        const cat = categoryOf('cli', c.category?.slug)
        return (
          <PanelRow
            key={c.slug}
            href={`/cli/${c.slug}`}
            icon={<EntityIcon name={c.name} src={c.iconUrl} color={cat.color} />}
            name={c.name}
            sub={c.command ? `$ ${c.command}` : null}
            mono
            badge={c.official && <span className="flex shrink-0 items-center gap-1 text-[11px] text-accent"><CheckCircle size={12} />{m.cli.official}</span>}
            tagline={c.tagline}
            chip={tr(cat.name)}
          />
        )
      })}
    </div>
  )
}

/** Loops：四个放在一块面板上，用细线分栏 */
function LoopPanel({ items }: { items: LoopItem[] }) {
  const { m, tr, to } = useI18n()
  return (
    <div className={`${panel} grid sm:grid-cols-2 lg:grid-cols-4`}>
      {items.map((l, i) => {
        const cat = categoryOf('loop', l.category?.slug)
        return (
          <Link
            key={l.slug}
            to={to(`/loops/${l.slug}`)}
            className="group flex flex-col gap-3 border-fg/[0.06] p-6 transition-colors hover:bg-fg/[0.025] max-sm:border-t sm:even:border-l lg:border-l lg:first:border-l-0"
            style={{ background: i % 2 ? 'color-mix(in oklab, var(--mf-fg) 1.2%, transparent)' : undefined }}
          >
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-fg/10 bg-fg/[0.05]" style={{ color: cat.color }}><cat.icon size={20} /></span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold transition-colors group-hover:text-accent">{l.name}</div>
                <div className="truncate text-xs text-text3">{tr(cat.name)}</div>
              </div>
            </div>
            <Tagline text={l.tagline} className="line-clamp-2 min-h-[42px] text-[13px] leading-[1.6]" />
            <div className="mt-auto flex items-center justify-between gap-2 text-xs text-text3">
              {l.loopType ? <Chip>{m.loop.type[l.loopType] ?? l.loopType}</Chip> : <span />}
              {l.maxIterations !== null && <span className="flex items-center gap-1"><ArrowsClockwise size={13} />{m.loop.maxIter(l.maxIterations)}</span>}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

/** 首页 Skill 卡片：带复制安装命令和安装量 */
function HomeSkillCard({ s }: { s: SkillItem }) {
  const { m, to } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full min-h-[180px] flex-col gap-3 p-5">
      <Link to={to(`/skills/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border" style={{ background: cat.color + '29', borderColor: cat.color + '4D', color: cat.color }}><cat.icon size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold"><span className="truncate">{s.name}</span>{s.official && <CheckCircle size={15} className="shrink-0 text-accent" />}</div>
          <div className="truncate text-xs text-text3">{repoPath(s.links.repository)}</div>
        </div>
      </div>
      <Tagline text={s.tagline} className="line-clamp-1 text-[13px] leading-[1.6]" />
      <div className="mt-auto flex flex-col gap-2.5">
        {s.installCommand && <CopyCommand cmd={s.installCommand} />}
        {s.installs !== null && <span className="flex items-center gap-1 text-xs text-text3"><DownloadSimple size={13} /><CountUp value={s.installs} /> {m.featured.installs}</span>}
      </div>
    </SpotlightCard>
  )
}

type FeaturedData = { server: ItemOf['server'][]; client: ItemOf['client'][]; cli: ItemOf['cli'][]; loop: ItemOf['loop'][]; skill: ItemOf['skill'][] }

/**
 * 精选区：每组换一种排法，避免"标题 + 四张等大卡片"重复五遍——
 * 服务是一大四小拼贴；客户端和 CLI 左右并排的列表面板；Loops 一块分栏面板；Skills 标题在左、右侧 2×2。
 */
export function Featured({ data, spotlight }: { data: FeaturedData; spotlight: ServerDetail | null }) {
  const { m } = useI18n()
  const f = m.featured
  return (
    <section className="border-y border-fg/[0.06]" style={{ background: 'radial-gradient(140% 40% at 50% 0%, #2B7FFF14, transparent 60%), var(--color-band)' }}>
      <div className="mx-auto flex max-w-[1248px] flex-col gap-16 px-6 py-20">
        <div>
          <SectionHeader title={f.servers.title} sub={f.servers.sub} link={f.servers.link} href="/servers" />
          <ServerBento items={data.server} spotlight={spotlight} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <SectionHeader title={f.clients.title} sub={f.clients.sub} link={f.clients.link} href="/clients" />
            <ClientPanel items={data.client} />
          </div>
          <div>
            <SectionHeader title={f.cli.title} sub={f.cli.sub} link={f.cli.link} href="/cli" />
            <CliPanel items={data.cli} />
          </div>
        </div>

        <div>
          <SectionHeader title={f.loops.title} sub={f.loops.sub} link={f.loops.link} href="/loops" />
          <LoopPanel items={data.loop} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[240px_1fr] lg:gap-12 [&>*]:min-w-0">
          <RevealGroup className="flex flex-col gap-5 pt-2">
            <RevealItem><h2 className="text-xl font-bold tracking-tight md:text-[22px]">{f.skills.title}</h2></RevealItem>
            <RevealItem><p className="text-sm leading-relaxed text-text2">{f.skills.sub}</p></RevealItem>
            <RevealItem>
              <LinkArrow href="/skills" className="font-medium text-ink">{f.skills.link}</LinkArrow>
            </RevealItem>
          </RevealGroup>
          <RevealGroup className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            {data.skill.map((s) => <RevealItem key={s.slug}><HomeSkillCard s={s} /></RevealItem>)}
          </RevealGroup>
        </div>
      </div>
    </section>
  )
}
