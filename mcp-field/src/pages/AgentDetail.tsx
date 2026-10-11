import { Buildings, CalendarBlank, Check, Compass, CopySimple, GithubLogo, Globe, Lightbulb, Lightning, ListChecks, Package, RocketLaunch, SquaresFour, Target } from '@phosphor-icons/react'
import { Comments } from '../components/Comments'
import { AgentTypeTag } from '../components/directory/AgentItems'
import {
  AboutSection, Badge, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { Chip } from '../components/ui'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { AgentDetail as Detail, AgentItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { developerOf, host, repoPath } from '../lib/entity'
import type { Route } from './+types/AgentDetail'

/** 主要功能：逐条打勾的清单 */
function FeaturesSection({ items }: { items: string[] }) {
  const { m } = useI18n()
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><ListChecks size={22} className="text-accent" />{m.detail.aiOverview.features}</h2>
      <RevealGroup className="mt-4 overflow-hidden rounded-2xl border border-fg/[0.08] bg-surface" stagger={0.04}>
        {items.map((f, i) => (
          <RevealItem key={i} className="flex gap-3.5 border-fg/[0.06] px-5 py-4 [&:not(:first-child)]:border-t">
            <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full border border-accent/25 bg-accent/10"><Check size={12} weight="bold" className="text-accent" /></span>
            <span className="text-sm leading-relaxed text-text2">{f}</span>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  )
}

const CASE_ICONS = [[Target, '#5B8DEF'], [Lightning, '#9B6CE0'], [RocketLaunch, '#D9577E'], [Compass, '#3DBE6E']] as const

/** 适用场景：两列卡片 */
function UseCasesSection({ items }: { items: string[] }) {
  const { m } = useI18n()
  if (items.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><Lightbulb size={22} className="text-accent" />{m.detail.aiOverview.useCases}</h2>
      <RevealGroup className="mt-4 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0" stagger={0.05}>
        {items.map((u, i) => {
          const [I, color] = CASE_ICONS[i % CASE_ICONS.length]!
          return (
            <RevealItem key={i} className="flex flex-col gap-3 rounded-2xl border border-fg/[0.08] bg-surface p-[18px] transition-colors hover:border-fg/15">
              <span className="grid size-8 place-items-center rounded-[9px] border" style={{ color, borderColor: `${color}40`, background: `${color}1F` }}><I size={16} /></span>
              <p className="text-sm leading-relaxed text-text2">{u}</p>
            </RevealItem>
          )
        })}
      </RevealGroup>
    </section>
  )
}

function Sidebar({ a, related }: { a: Detail; related: AgentItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.agent.infoKeys
  const developer = developerOf(a)
  const link = (href: string | null, label: string | null) => href && <a href={href} target="_blank" rel="noreferrer" className="hover:text-accent">{label ?? href}</a>
  return (
    <>
      <RelatedSection
        kind="agent"
        title={m.agent.related}
        items={related}
        allLabel={m.agent.all}
        footer={(r) => (
          <div className="flex items-center gap-1.5">
            <Chip>{tr(categoryOf('agent', r.category?.slug).name)}</Chip>
            <AgentTypeTag type={r.agentType} />
          </div>
        )}
      />
      <InfoSection
        kind="agent"
        d={a}
        rows={[
          { icon: Buildings, label: k.developer, value: developer && (a.author?.url ? link(a.author.url, developer) : developer) },
          { icon: Package, label: k.type, value: a.agentType && (m.agent.type[a.agentType] ?? a.agentType) },
          { icon: SquaresFour, label: k.category, value: tr(categoryOf('agent', a.category?.slug).name) },
          { icon: Globe, label: k.website, value: link(a.links.website, host(a.links.website)) },
          { icon: GithubLogo, label: k.repo, value: link(a.links.repository, repoPath(a.links.repository)) },
          { icon: CalendarBlank, label: k.added, value: fmt(a.source.sourceCreatedAt) },
        ]}
      />
    </>
  )
}

function Page({ a, related }: { a: Detail; related: AgentItem[] }) {
  const { m } = useI18n()
  const fmt = useDateFormat()
  const added = fmt(a.source.sourceCreatedAt)
  const template = a.agentType === 'template'
  return (
    <>
      <DetailSeo kind="agent" d={a} section={m.dirs.agents.title} />
      <EntityHeader
        kind="agent"
        d={a}
        listTitle={m.dirs.agents.title}
        badges={a.agentType && <Badge tone={template ? 'violet' : 'gray'} icon={template ? CopySimple : Package}>{m.agent.type[a.agentType] ?? a.agentType}</Badge>}
        meta={added && <span className="flex items-center gap-1"><CalendarBlank size={14} />{m.agent.added(added)}</span>}
      />
      <DetailBody
        main={
          <>
            <AboutSection d={a} summaryOnly />
            {a.overview && <FeaturesSection items={a.overview.features} />}
            {a.overview && <UseCasesSection items={a.overview.useCases} />}
            <section><Comments key={a.slug} target={`agent:${a.slug}`} /></section>
          </>
        }
        aside={<Sidebar a={a} related={related} />}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('agent', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.agent.notFound} listHref="/agents" />
}

export default function AgentDetail({ loaderData }: Route.ComponentProps) {
  return <Page a={loaderData.d} related={loaderData.related} />
}
