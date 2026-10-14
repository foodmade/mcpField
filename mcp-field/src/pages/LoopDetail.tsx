import { ArrowsClockwise, CalendarBlank, FlagCheckered, Lightning, Robot, SquaresFour } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Comments } from '../components/Comments'
import { CopyButton, PrimaryCopyButton } from '../components/detail/CopyButton'
import {
  AboutSection, Badge, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { SectionNav, useActiveSection, type SectionItem } from '../components/detail/SectionNav'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { LoopDetail as Detail, Playbook, LoopItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { useCommentCount } from '../lib/comments'
import { buildLoopPrompt } from '../lib/loopPrompt'
import type { Route } from './+types/LoopDetail'

/** 启动提示词：可直接粘贴给编码 Agent */
function PromptSection({ l, prompt }: { l: Detail; prompt: string }) {
  const { m } = useI18n()
  const agents = l.supportedAgents.filter((a) => a.active).map((a) => a.name).join(' / ') || 'Agent'
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.loop.prompt}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.loop.promptSub(agents)}</p>
      <div className="overflow-hidden rounded-[14px] border border-fg/10 bg-code-bg">
        <div className="flex items-center justify-between border-b border-fg/[0.08] py-2 pl-4 pr-3">
          <span className="font-mono text-xs text-text3">prompt.md</span>
          <CopyButton text={prompt} />
        </div>
        <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap px-4 py-3.5 font-mono text-[13px] leading-[1.75] text-ink/90 [scrollbar-width:thin]">{prompt}</pre>
      </div>
    </>
  )
}

/** 每一轮的步骤：左侧编号与连接线组成时间线，右侧标题、说明、命令；最后是退出判断 */
function StepsSection({ l, playbook }: { l: Detail; playbook: Playbook }) {
  const { m } = useI18n()
  if (playbook.steps.length === 0) return null
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.loop.stepsTitle}</h2>
      <p className="mb-5 mt-1.5 text-sm text-text2">{m.loop.stepsSub(l.maxIterations ?? 1)}</p>
      <RevealGroup className="flex flex-col" stagger={0.05}>
        {playbook.steps.map((s, i) => (
          <RevealItem key={s.position} className="group relative flex gap-4 pb-6">
            {/* 连接到下一步（以及最后的退出判断）的竖线 */}
            <span aria-hidden className="absolute bottom-0 left-[13.5px] top-8 w-px bg-line" />
            <span className="relative grid size-7 shrink-0 place-items-center rounded-full border border-fg/[0.12] bg-bg font-mono text-xs tabular-nums text-text2 transition-colors group-hover:border-accent/50 group-hover:text-accent">{String(i + 1).padStart(2, '0')}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[15px] font-semibold text-ink">{s.title}</div>
              {s.body && <p className="mt-1 max-w-[46em] text-sm leading-relaxed text-text2">{s.body}</p>}
              {s.command && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-fg/[0.08] bg-code-bg py-1.5 pl-3 pr-1.5">
                  <span className="font-mono text-xs text-fg/30">$</span>
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-ink [scrollbar-width:none]">{s.command}</code>
                  <CopyButton text={s.command} />
                </div>
              )}
            </div>
          </RevealItem>
        ))}
        <RevealItem>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-full bg-fg/[0.06] px-2.5 py-1 text-text2"><ArrowsClockwise size={13} />{m.loop.nextRound}</span>
            <span className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-mint"><FlagCheckered size={13} />{m.loop.exitBadge}</span>
          </div>
        </RevealItem>
      </RevealGroup>
    </>
  )
}

/** 目标与退出条件 */
function GoalSection({ l, playbook }: { l: Detail; playbook: Playbook }) {
  const { m } = useI18n()
  const items = [
    { label: m.loop.p.goal, value: playbook.goal },
    { label: m.loop.infoKeys.exit, value: playbook.exitCondition },
    { label: m.loop.p.between, value: l.checkCommand, mono: true },
  ].filter((i) => i.value)
  if (items.length === 0) return null
  // 紧接在"关于"的两栏列表（自带底线）下方，所以只画底线，避免出现两条挨着的横线
  return (
    <dl className="divide-y divide-fg/[0.06] border-b border-line">
      {items.map(({ label, value, mono }) => (
        <div key={label} className="grid gap-1 py-3.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-6">
          <dt className="pt-0.5 text-xs font-medium tracking-wide text-text3">{label}</dt>
          <dd className={clsx('leading-relaxed', mono ? 'w-fit break-all rounded-md bg-fg/[0.06] px-2 py-0.5 font-mono text-[13px] text-ink' : 'text-[15px] text-text2')}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 可以直接运行这个 Loop 的编码 Agent */
function AgentsSection({ l }: { l: Detail }) {
  const { m } = useI18n()
  if (l.supportedAgents.length === 0) return null
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.loop.agents}</h2>
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
    </>
  )
}

function Sidebar({ l, related }: { l: Detail; related: LoopItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.loop.infoKeys
  return (
    <>
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
      <RelatedSection kind="loop" title={m.loop.related} items={related} allLabel={m.loop.all} />
    </>
  )
}

type LoopSection = 'overview' | 'prompt' | 'steps' | 'agents' | 'comments'

function Page({ l, related }: { l: Detail; related: LoopItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('loop', l.category?.slug)
  const prompt = l.playbook ? buildLoopPrompt(l, l.playbook, m.loop.p) : null
  const steps = !!l.playbook?.steps.length
  const sections: SectionItem<LoopSection>[] = [
    { id: 'overview', label: m.detail.sections.overview },
    ...(prompt ? [{ id: 'prompt' as const, label: m.loop.prompt }] : []),
    ...(steps ? [{ id: 'steps' as const, label: m.loop.stepsTitle }] : []),
    ...(l.supportedAgents.length ? [{ id: 'agents' as const, label: m.loop.agents }] : []),
    { id: 'comments', label: m.comments.title, count: useCommentCount(`loop:${l.slug}`) },
  ]
  const { active, jump, reg } = useActiveSection(sections.map((x) => x.id), l.slug)
  return (
    <>
      <DetailSeo kind="loop" d={l} section={m.dirs.loops.title} />
      <EntityHeader
        kind="loop"
        d={l}
        listTitle={m.dirs.loops.title}
        tile={<span className="grid size-[72px] place-items-center rounded-[18px] border border-fg/15 bg-fg/[0.06]" style={{ color: cat.color }}><cat.icon size={34} /></span>}
        badges={l.loopType ? <Badge quiet tone="gray" icon={Lightning}>{m.loop.type[l.loopType] ?? l.loopType}</Badge> : undefined}
        meta={l.maxIterations !== null && <span className="flex items-center gap-1"><ArrowsClockwise size={14} />{m.loop.maxIter(l.maxIterations)}</span>}
        actions={prompt ? <PrimaryCopyButton text={prompt} label={m.loop.copyPrompt} /> : <></>}
      />
      <DetailBody
        nav={<SectionNav items={sections} active={active} onJump={jump} />}
        faq={false}
        main={
          <>
            <section ref={reg('overview')} className="flex flex-col gap-6">
              <AboutSection d={l} />
              {l.playbook && <GoalSection l={l} playbook={l.playbook} />}
            </section>
            {prompt && <section ref={reg('prompt')}><PromptSection l={l} prompt={prompt} /></section>}
            {l.playbook && steps && <section ref={reg('steps')}><StepsSection l={l} playbook={l.playbook} /></section>}
            {l.supportedAgents.length > 0 && <section ref={reg('agents')}><AgentsSection l={l} /></section>}
            <section ref={reg('comments')}><Comments key={l.slug} target={`loop:${l.slug}`} /></section>
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
