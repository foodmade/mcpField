import { motion } from 'motion/react'
import { BookOpen, Buildings, CalendarCheck, ClockCounterClockwise, Code, GithubLogo, Globe, Info, Robot, Scales, Terminal } from '@phosphor-icons/react'
import { useState } from 'react'
import clsx from 'clsx'
import { Comments } from '../components/Comments'
import { CopyButton, PrimaryCopyButton } from '../components/detail/CopyButton'
import {
  AboutSection, Badge, DefaultActions, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, LinkButton, ReadmeSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { SectionNav, useActiveSection, type SectionItem } from '../components/detail/SectionNav'
import { EntityIcon } from '../components/EntityIcon'
import { useHydrated } from '../fx/hydration'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { CliDetail as Detail, CliItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { useCommentCount } from '../lib/comments'
import { daysSince, developerOf } from '../lib/entity'
import type { Route } from './+types/CliDetail'

/** 命令着色：程序名、参数、其余 */
function Cmd({ cmd, className }: { cmd: string; className?: string }) {
  const [prog, ...rest] = cmd.split(' ')
  return (
    <code className={clsx('whitespace-pre font-mono', className)}>
      <span className="text-code">{prog}</span>
      {rest.map((w, i) => <span key={i} className={w.startsWith('-') ? 'text-sky' : 'text-ink'}>{' ' + w}</span>)}
    </code>
  )
}

/** 安装方式：多种包管理器 / 平台时可切换 */
function InstallSection({ c }: { c: Detail }) {
  const { m } = useI18n()
  // 首屏直接显示命令；切换安装方式时（水合之后）才播放过渡
  const enter = useHydrated()
  const [method, setMethod] = useState(0)
  if (c.installs.length === 0) return null
  const install = c.installs[Math.min(method, c.installs.length - 1)]!
  const label = (i: Detail['installs'][number]) => (i.platform === 'any' ? i.manager : `${i.manager} · ${i.platform}`)
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.cli.install}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.cli.installSub}</p>
      {c.installs.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
          {c.installs.map((i, idx) => (
            <button key={i.command} role="tab" aria-selected={method === idx} onClick={() => setMethod(idx)} className={clsx('relative h-8 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors', method === idx ? 'border-fg/25 font-medium text-ink' : 'border-fg/[0.06] text-text2 hover:text-ink')}>
              {method === idx && <motion.span layoutId="install-pill" className="absolute inset-0 rounded-[7px] bg-fg/[0.09]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{label(i)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 rounded-[14px] border border-fg/10 bg-code-bg py-3.5 pl-[18px] pr-3">
        <span className="font-mono text-sm text-fg/30">$</span>
        <motion.div key={install.command} initial={enter ? { opacity: 0, x: 6 } : false} animate={{ opacity: 1, x: 0 }} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <Cmd cmd={install.command} className="text-sm" />
        </motion.div>
        <CopyButton text={install.command} />
      </div>
      {c.command && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text3">
          <Info size={14} />{m.cli.verifyBefore}
          <code className="rounded-[5px] bg-fg/[0.07] px-1.5 py-px font-mono text-ink">{c.command} --version</code>
          {m.cli.verifyAfter}
        </p>
      )}
    </>
  )
}

function ExamplesSection({ c }: { c: Detail }) {
  const { m } = useI18n()
  if (c.examples.length === 0) return null
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.cli.examples}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.cli.examplesSub}</p>
      <RevealGroup className="divide-y divide-fg/[0.06] overflow-hidden rounded-[14px] border border-fg/10 bg-code-bg" stagger={0.04}>
        {c.examples.map((cmd, i) => (
          <RevealItem key={cmd} className="group flex items-center gap-4 py-2.5 pl-[18px] pr-3 transition-colors hover:bg-fg/[0.025]">
            <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-text3 transition-colors group-hover:text-accent">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"><Cmd cmd={cmd} className="text-sm" /></div>
            <CopyButton text={cmd} />
          </RevealItem>
        ))}
      </RevealGroup>
    </>
  )
}

function Sidebar({ c, related }: { c: Detail; related: CliItem[] }) {
  const { m } = useI18n()
  const fmt = useDateFormat()
  const k = m.cli.infoKeys
  const updated = daysSince(c.lastCommitAt)
  return (
    <>
      <InfoSection
        kind="cli"
        d={c}
        rows={[
          { icon: Buildings, label: k.developer, value: developerOf(c) },
          { icon: Terminal, label: k.command, value: c.command && <code className="font-mono">{[c.command, ...c.aliases.filter((a) => a !== c.command && !a.includes(' '))].join(' · ')}</code> },
          { icon: Scales, label: k.license, value: c.license },
          { icon: CalendarCheck, label: m.cli.verified, value: fmt(c.lastVerifiedOn) },
          { icon: ClockCounterClockwise, label: k.updated, value: updated === null ? null : m.detail.ago(updated) },
        ]}
      />
      <RelatedSection kind="cli" title={m.cli.related} items={related} allLabel={m.cli.all} />
    </>
  )
}

type CliSection = 'overview' | 'install' | 'examples' | 'readme' | 'comments'

/** 头部按钮：有安装命令时"复制安装命令"是唯一的主按钮，文档、仓库、官网都是次要按钮；没有时沿用默认按钮 */
function Actions({ c, primary }: { c: Detail; primary?: string }) {
  const { m } = useI18n()
  if (!primary) return <DefaultActions d={c} />
  const { docs, repository, website } = c.links
  return (
    <>
      {docs && <LinkButton href={docs} icon={BookOpen} label={m.detail.links.docs} />}
      {repository && <LinkButton href={repository} icon={GithubLogo} label={m.detail.links.repo} />}
      {website && <LinkButton href={website} icon={Globe} label={m.client.visit} />}
      <PrimaryCopyButton text={primary} label={m.cli.copyInstall} />
    </>
  )
}

function Page({ c, related }: { c: Detail; related: CliItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('cli', c.category?.slug)
  const primary = c.installs[0]?.command
  const sections: SectionItem<CliSection>[] = [
    { id: 'overview', label: m.detail.sections.overview },
    ...(c.installs.length ? [{ id: 'install' as const, label: m.cli.install }] : []),
    ...(c.examples.length ? [{ id: 'examples' as const, label: m.cli.examples }] : []),
    ...(c.readme ? [{ id: 'readme' as const, label: m.detail.sections.readme }] : []),
    { id: 'comments', label: m.comments.title, count: useCommentCount(`cli:${c.slug}`) },
  ]
  const { active, jump, reg } = useActiveSection(sections.map((x) => x.id), c.slug)
  return (
    <>
      <DetailSeo kind="cli" d={c} section={m.dirs.cli.title} />
      <EntityHeader
        kind="cli"
        d={c}
        listTitle={m.dirs.cli.title}
        tile={
          <span className="relative block">
            <EntityIcon name={c.name} src={c.iconUrl} color={cat.color} size={72} className="!rounded-[18px] border border-fg/15" />
            <span className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-lg border border-fg/20 bg-bg text-ink"><Terminal size={15} /></span>
          </span>
        }
        badges={c.agentReady ? <Badge quiet tone="gray" icon={Robot}>{m.cli.agentReady}</Badge> : undefined}
        meta={c.command && <span className="flex items-center gap-1 font-mono text-code"><Code size={14} />{c.command}</span>}
        actions={<Actions c={c} primary={primary} />}
      />
      <DetailBody
        nav={<SectionNav items={sections} active={active} onJump={jump} />}
        faq={false}
        main={
          <>
            <section ref={reg('overview')}><AboutSection d={c} /></section>
            {c.installs.length > 0 && <section ref={reg('install')}><InstallSection c={c} /></section>}
            {c.examples.length > 0 && <section ref={reg('examples')}><ExamplesSection c={c} /></section>}
            {c.readme && <section ref={reg('readme')}><ReadmeSection d={c} /></section>}
            <section ref={reg('comments')}><Comments key={c.slug} target={`cli:${c.slug}`} /></section>
          </>
        }
        aside={<Sidebar c={c} related={related} />}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('cli', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.cli.notFound} listHref="/cli" />
}

export default function CliDetail({ loaderData }: Route.ComponentProps) {
  return <Page c={loaderData.d} related={loaderData.related} />
}
