import { Buildings, CalendarBlank, CopySimple, GithubLogo, Globe, Package, SquaresFour } from '@phosphor-icons/react'
import { Comments } from '../components/Comments'
import { AgentTypeTag } from '../components/directory/AgentItems'
import {
  AboutSection, Badge, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { Chip } from '../components/ui'
import { useI18n } from '../i18n/context'
import type { AgentDetail as Detail, AgentItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { developerOf, host, repoPath } from '../lib/entity'
import type { Route } from './+types/AgentDetail'

function Sidebar({ a, related }: { a: Detail; related: AgentItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.agent.infoKeys
  const developer = developerOf(a)
  const link = (href: string | null, label: string | null) => href && <a href={href} target="_blank" rel="noreferrer" className="hover:text-accent">{label ?? href}</a>
  return (
    <>
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
        badges={a.agentType && <Badge quiet tone="gray" icon={template ? CopySimple : Package}>{m.agent.type[a.agentType] ?? a.agentType}</Badge>}
        meta={added && <span className="flex items-center gap-1"><CalendarBlank size={14} />{m.agent.added(added)}</span>}
      />
      <DetailBody
        faq={false}
        main={
          <>
            <AboutSection d={a} />
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
