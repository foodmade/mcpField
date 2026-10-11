import { AnimatePresence, motion } from 'motion/react'
import { Check, CheckCircle, Copy, DownloadSimple } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CountUp } from '../fx/CountUp'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { SpotlightCard } from '../fx/SpotlightCard'
import { useI18n } from '../i18n/context'
import type { ItemOf, SkillItem } from '../lib/api/entities'
import { categoryOf } from '../lib/categories'
import { repoPath } from '../lib/entity'
import { ClientCard } from './directory/ClientItems'
import { CliCard } from './directory/CliItems'
import { LoopCard } from './directory/LoopItems'
import { ServerCard, Tagline } from './directory/ServerItems'
import { SectionHeader } from './ui'

function Row({ children }: { children: ReactNode }) {
  return <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">{children}</RevealGroup>
}

/** 某类型的推荐条目（精选优先，不足时用热门补齐，由首页 loader 取回） */
function FeaturedRow<T extends { slug: string }>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  return <Row>{items.map((item) => <RevealItem key={item.slug}>{render(item)}</RevealItem>)}</Row>
}

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
    <button onClick={copy} aria-label={m.featured.copy} className="relative z-20 flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-black/35 px-2.5 py-[7px] text-left transition-colors hover:border-white/20">
      <span className="truncate font-mono text-xs text-text2">{cmd}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(copied)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className={copied ? 'flex items-center gap-1 text-xs text-accent' : 'text-text3'}>
          {copied ? <><Check size={13} weight="bold" />{m.featured.copied}</> : <Copy size={13} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** 首页 Skill 卡片：带复制安装命令和安装量 */
function HomeSkillCard({ s }: { s: SkillItem }) {
  const { m, to } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  return (
    <SpotlightCard glow={cat.color} className="flex h-full min-h-[208px] flex-col gap-3 p-5">
      <Link to={to(`/skills/${s.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={s.name} />
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border" style={{ background: cat.color + '29', borderColor: cat.color + '4D', color: cat.color }}><cat.icon size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold"><span className="truncate">{s.name}</span>{s.official && <CheckCircle size={15} className="shrink-0 text-accent" />}</div>
          <div className="truncate text-xs text-text3">{repoPath(s.links.repository)}</div>
        </div>
      </div>
      <Tagline text={s.tagline} className="line-clamp-2 min-h-[42px] text-[13px] leading-[1.6]" />
      <div className="mt-auto flex flex-col gap-2.5">
        {s.installCommand && <CopyCommand cmd={s.installCommand} />}
        {s.installs !== null && <span className="flex items-center gap-1 text-xs text-text3"><DownloadSimple size={13} /><CountUp value={s.installs} /> {m.featured.installs}</span>}
      </div>
    </SpotlightCard>
  )
}

type FeaturedData = { server: ItemOf['server'][]; client: ItemOf['client'][]; cli: ItemOf['cli'][]; loop: ItemOf['loop'][]; skill: ItemOf['skill'][] }

export function Featured({ data }: { data: FeaturedData }) {
  const { m } = useI18n()
  const GROUPS = [
    { key: 'servers', href: '/servers', body: <FeaturedRow items={data.server} render={(s) => <ServerCard s={s} />} /> },
    { key: 'clients', href: '/clients', body: <FeaturedRow items={data.client} render={(c) => <ClientCard c={c} />} /> },
    { key: 'cli', href: '/cli', body: <FeaturedRow items={data.cli} render={(c) => <CliCard c={c} />} /> },
    { key: 'loops', href: '/loops', body: <FeaturedRow items={data.loop} render={(l) => <LoopCard l={l} />} /> },
    { key: 'skills', href: '/skills', body: <FeaturedRow items={data.skill} render={(s) => <HomeSkillCard s={s} />} /> },
  ] as const
  return (
    <section
      className="border-y border-white/[0.06]"
      style={{ background: 'radial-gradient(140% 40% at 50% 0%, #2B7FFF14, transparent 60%), #0D0F12' }}
    >
      <div className="mx-auto flex max-w-[1248px] flex-col gap-16 px-6 py-20">
        {GROUPS.map(({ key, href, body }) => {
          const t = m.featured[key]
          return (
            <div key={key}>
              <SectionHeader title={t.title} sub={t.sub} link={t.link} href={href} />
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}
