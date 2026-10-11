import { motion } from 'motion/react'
import { Buildings, CalendarCheck, Check, ClockCounterClockwise, Code, Copy, DownloadSimple, Info, Robot, Scales, Terminal, TerminalWindow } from '@phosphor-icons/react'
import { useState } from 'react'
import clsx from 'clsx'
import { Comments } from '../components/Comments'
import { CopyButton, copyText } from '../components/detail/CopyButton'
import {
  AboutSection, Badge, DefaultActions, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, ReadmeSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { EntityIcon } from '../components/EntityIcon'
import { useHydrated } from '../fx/hydration'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { CliDetail as Detail, CliItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
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

/** 头部主按钮：复制首选安装命令 */
function CopyInstall({ cmd }: { cmd: string }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        copyText(cmd)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-6px_#3DDC9780]"
    >
      {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
      {copied ? m.detail.copied : m.cli.copyInstall}
    </motion.button>
  )
}

/** 安装方式：多种包管理器 / 平台时可切换 */
function InstallSection({ c, glow }: { c: Detail; glow: string }) {
  const { m } = useI18n()
  // 首屏直接显示命令；切换安装方式时（水合之后）才播放过渡
  const enter = useHydrated()
  const [method, setMethod] = useState(0)
  if (c.installs.length === 0) return null
  const install = c.installs[Math.min(method, c.installs.length - 1)]!
  const label = (i: Detail['installs'][number]) => (i.platform === 'any' ? i.manager : `${i.manager} · ${i.platform}`)
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><DownloadSimple size={22} className="text-accent" />{m.cli.install}</h2>
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
      <div className="flex items-center gap-3 rounded-[14px] border border-fg/10 py-3.5 pl-[18px] pr-3" style={{ background: `radial-gradient(80% 250% at 100% 0%, ${glow}1F, transparent 60%), var(--color-code-bg)` }}>
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
    </section>
  )
}

function ExamplesSection({ c }: { c: Detail }) {
  const { m } = useI18n()
  if (c.examples.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><TerminalWindow size={22} className="text-accent" />{m.cli.examples}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.cli.examplesSub}</p>
      <RevealGroup className="flex flex-col gap-3" stagger={0.05}>
        {c.examples.map((cmd, i) => (
          <RevealItem key={cmd}>
            <div className="flex items-center gap-4 rounded-[14px] border border-fg/[0.08] bg-surface py-3.5 pl-[18px] pr-3.5 transition-colors hover:border-fg/15">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-fg/[0.12] bg-fg/[0.06] tabular-nums text-sm font-semibold">{i + 1}</span>
              <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"><Cmd cmd={cmd} className="text-sm" /></div>
              <CopyButton text={cmd} />
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  )
}

function Sidebar({ c, related }: { c: Detail; related: CliItem[] }) {
  const { m } = useI18n()
  const fmt = useDateFormat()
  const k = m.cli.infoKeys
  const updated = daysSince(c.lastCommitAt)
  return (
    <>
      <RelatedSection kind="cli" title={m.cli.related} items={related} allLabel={m.cli.all} />
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
    </>
  )
}

function Page({ c, related }: { c: Detail; related: CliItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('cli', c.category?.slug)
  const primary = c.installs[0]?.command
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
        badges={c.agentReady ? <Badge tone="gray" icon={Robot}>{m.cli.agentReady}</Badge> : undefined}
        meta={c.command && <span className="flex items-center gap-1 font-mono text-code"><Code size={14} />{c.command}</span>}
        actions={
          <>
            <DefaultActions d={c} />
            {primary && <CopyInstall cmd={primary} />}
          </>
        }
      />
      <DetailBody
        main={
          <>
            <AboutSection d={c} />
            <InstallSection c={c} glow={cat.color} />
            <ExamplesSection c={c} />
            {c.readme && <section><ReadmeSection d={c} /></section>}
            <section><Comments key={c.slug} target={`cli:${c.slug}`} /></section>
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
