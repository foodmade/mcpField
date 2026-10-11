import { motion } from 'motion/react'
import { ArrowsClockwise, CalendarBlank, Check, Copy, FlagCheckered, Lightning, ListChecks, Robot, SquaresFour, Target, TerminalWindow } from '@phosphor-icons/react'
import { useState } from 'react'
import clsx from 'clsx'
import { Comments } from '../components/Comments'
import { CopyButton, copyText } from '../components/detail/CopyButton'
import {
  AboutSection, Badge, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { LoopDetail as Detail, Playbook, LoopItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { buildLoopPrompt } from '../lib/loopPrompt'
import type { Route } from './+types/LoopDetail'

function CopyPromptButton({ text }: { text: string }) {
  const { m } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
      className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-6px_#3DDC9780]"
    >
      {done ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
      {done ? m.detail.copied : m.loop.copyPrompt}
    </motion.button>
  )
}

/** 启动提示词：可直接粘贴给编码 Agent */
function PromptSection({ l, prompt, glow }: { l: Detail; prompt: string; glow: string }) {
  const { m } = useI18n()
  const agents = l.supportedAgents.filter((a) => a.active).map((a) => a.name).join(' / ') || 'Agent'
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><TerminalWindow size={22} className="text-accent" />{m.loop.prompt}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.loop.promptSub(agents)}</p>
      <div className="overflow-hidden rounded-[14px] border border-fg/10" style={{ background: `radial-gradient(90% 140% at 100% 0%, ${glow}1F, transparent 60%), var(--color-code-bg)` }}>
        <div className="flex items-center justify-between border-b border-fg/[0.08] py-2 pl-4 pr-3">
          <span className="font-mono text-xs text-text3">prompt.md</span>
          <CopyButton text={prompt} />
        </div>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap px-4 py-3.5 font-mono text-[13px] leading-[1.75] text-ink/90 [scrollbar-width:thin]">{prompt}</pre>
      </div>
    </section>
  )
}

/** 每一轮的步骤：编号、标题、说明、命令；最后是退出判断 */
function StepsSection({ l, playbook }: { l: Detail; playbook: Playbook }) {
  const { m } = useI18n()
  if (playbook.steps.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><ListChecks size={22} className="text-accent" />{m.loop.stepsTitle}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.loop.stepsSub(l.maxIterations ?? 1)}</p>
      <RevealGroup className="flex flex-col gap-3" stagger={0.05}>
        {playbook.steps.map((s, i) => (
          <RevealItem key={s.position}>
            <div className="flex gap-4 rounded-[14px] border border-fg/[0.08] bg-surface px-[18px] py-4 transition-colors hover:border-fg/15">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-accent/25 bg-accent/10 tabular-nums text-sm font-semibold text-accent">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{s.title}</div>
                {s.body && <p className="mt-1 text-sm leading-relaxed text-text2">{s.body}</p>}
                {s.command && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-fg/[0.08] bg-fg/[0.04] py-1.5 pl-3 pr-1.5">
                    <span className="font-mono text-xs text-fg/30">$</span>
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-ink [scrollbar-width:none]">{s.command}</code>
                    <CopyButton text={s.command} />
                  </div>
                )}
              </div>
            </div>
          </RevealItem>
        ))}
        <RevealItem>
          <div className="flex flex-wrap items-center gap-2 pl-1 text-xs">
            <span className="flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2.5 py-1 text-text2"><ArrowsClockwise size={13} />{m.loop.nextRound}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-mint"><FlagCheckered size={13} />{m.loop.exitBadge}</span>
          </div>
        </RevealItem>
      </RevealGroup>
    </section>
  )
}

/** 目标与退出条件 */
function GoalSection({ l, playbook }: { l: Detail; playbook: Playbook }) {
  const { m } = useI18n()
  const items = [
    { icon: Target, label: m.loop.p.goal, value: playbook.goal },
    { icon: FlagCheckered, label: m.loop.infoKeys.exit, value: playbook.exitCondition },
    { icon: TerminalWindow, label: m.loop.p.between, value: l.checkCommand, mono: true },
  ].filter((i) => i.value)
  if (items.length === 0) return null
  return (
    <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      {items.map(({ icon: I, label, value, mono }) => (
        <div key={label} className="rounded-2xl border border-fg/[0.08] bg-surface p-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-text3"><I size={14} className="text-accent" />{label}</div>
          <div className={clsx('text-sm leading-relaxed', mono ? 'break-all font-mono text-xs text-ink' : 'text-text2')}>{value}</div>
        </div>
      ))}
    </div>
  )
}

/** 可以直接运行这个 Loop 的编码 Agent */
function AgentsSection({ l }: { l: Detail }) {
  const { m } = useI18n()
  if (l.supportedAgents.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><Robot size={22} className="text-accent" />{m.loop.agents}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.loop.agentsSub}</p>
      <RevealGroup className="flex flex-wrap gap-2.5" stagger={0.05}>
        {l.supportedAgents.map((a) => (
          <RevealItem key={a.name}>
            <span className={clsx('flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm', a.active ? 'border-fg/[0.12] bg-surface text-ink' : 'border-fg/[0.06] text-text3 line-through')}>
              <Robot size={15} className={a.active ? 'text-accent' : ''} />{a.name}
            </span>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  )
}

function Sidebar({ l, related }: { l: Detail; related: LoopItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.loop.infoKeys
  return (
    <>
      <RelatedSection kind="loop" title={m.loop.related} items={related} allLabel={m.loop.all} />
      <InfoSection
        kind="loop"
        d={l}
        rows={[
          { icon: SquaresFour, label: m.client.infoKeys.category, value: tr(categoryOf('loop', l.category?.slug).name) },
          { icon: Lightning, label: k.trigger, value: l.loopType && (m.loop.type[l.loopType] ?? l.loopType) },
          { icon: ArrowsClockwise, label: k.maxIter, value: l.maxIterations },
          { icon: Robot, label: k.clients, value: l.supportedAgents.filter((a) => a.active).map((a) => a.name).join(' · ') },
          { icon: CalendarBlank, label: k.added, value: fmt(l.source.sourceCreatedAt) },
        ]}
      />
    </>
  )
}

function Page({ l, related }: { l: Detail; related: LoopItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('loop', l.category?.slug)
  const prompt = l.playbook ? buildLoopPrompt(l, l.playbook, m.loop.p) : null
  return (
    <>
      <DetailSeo kind="loop" d={l} section={m.dirs.loops.title} />
      <EntityHeader
        kind="loop"
        d={l}
        listTitle={m.dirs.loops.title}
        tile={<span className="grid size-[72px] place-items-center rounded-[18px] border border-fg/15 bg-fg/[0.06]" style={{ color: cat.color }}><cat.icon size={34} /></span>}
        badges={l.loopType ? <Badge tone="gray" icon={Lightning}>{m.loop.type[l.loopType] ?? l.loopType}</Badge> : undefined}
        meta={l.maxIterations !== null && <span className="flex items-center gap-1"><ArrowsClockwise size={14} />{m.loop.maxIter(l.maxIterations)}</span>}
        actions={prompt ? <CopyPromptButton text={prompt} /> : <></>}
      />
      <DetailBody
        main={
          <>
            <section className="flex flex-col gap-5">
              <AboutSection d={l} />
              {l.playbook && <GoalSection l={l} playbook={l.playbook} />}
            </section>
            {prompt && <PromptSection l={l} prompt={prompt} glow={cat.color} />}
            {l.playbook && <StepsSection l={l} playbook={l.playbook} />}
            <AgentsSection l={l} />
            <section><Comments key={l.slug} target={`loop:${l.slug}`} /></section>
          </>
        }
        aside={<Sidebar l={l} related={related} />}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('loop', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.loop.notFound} listHref="/loops" />
}

export default function LoopDetail({ loaderData }: Route.ComponentProps) {
  return <Page l={loaderData.d} related={loaderData.related} />
}
