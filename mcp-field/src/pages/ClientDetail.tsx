import { Buildings, CalendarBlank, ClockCounterClockwise, Cpu, Scales, SquaresFour, Star } from '@phosphor-icons/react'
import { Comments } from '../components/Comments'
import {
  AboutSection, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, ReadmeSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { useI18n } from '../i18n/context'
import type { ClientDetail as Detail, ClientItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { daysSince, developerOf } from '../lib/entity'
import type { Route } from './+types/ClientDetail'

function Sidebar({ c, related }: { c: Detail; related: ClientItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.client.infoKeys
  const updated = daysSince(c.lastCommitAt)
  const developer = developerOf(c)
  return (
    <>
      <RelatedSection kind="client" title={m.client.related} items={related} allLabel={m.client.allClients} />
      <InfoSection
        kind="client"
        d={c}
        rows={[
          { icon: Buildings, label: k.developer, value: developer && (c.author?.url ? <a href={c.author.url} target="_blank" rel="noreferrer" className="hover:text-accent">{developer}</a> : developer) },
          { icon: SquaresFour, label: k.category, value: tr(categoryOf('client', c.category?.slug).name) },
          { icon: Star, label: k.stars, value: c.stars?.toLocaleString('en-US') },
          { icon: Scales, label: k.license, value: c.license },
          { icon: Cpu, label: k.runtime, value: c.runtime },
          { icon: CalendarBlank, label: k.added, value: fmt(c.source.sourceCreatedAt) },
          { icon: ClockCounterClockwise, label: k.updated, value: updated === null ? null : m.detail.ago(updated) },
        ]}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('client', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.client.notFound} listHref="/clients" />
}

export default function ClientDetail({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  const { d: c, related } = loaderData
  return (
    <>
      <DetailSeo kind="client" d={c} section={m.dirs.clients.title} />
      <EntityHeader kind="client" d={c} listTitle={m.dirs.clients.title} />
      <DetailBody
        main={
          <>
            <AboutSection d={c} />
            <section><ReadmeSection d={c} empty={m.client.noReadme} /></section>
            <section><Comments key={c.slug} target={`client:${c.slug}`} /></section>
          </>
        }
        aside={<Sidebar c={c} related={related} />}
      />
    </>
  )
}
