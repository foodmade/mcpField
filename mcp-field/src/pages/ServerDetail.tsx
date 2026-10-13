import { CalendarBlank, Certificate, ClockCounterClockwise, CloudArrowUp, Code, Desktop, PlugsConnected, Scales, Stack, Tag, User } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Comments } from '../components/Comments'
import { ConfigSection } from '../components/detail/ConfigSection'
import {
  AboutSection, Badge, DefaultActions, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, ReadmeSection, RelatedSection, sourcesValue, useDateFormat,
} from '../components/detail/EntityDetail'
import { InstallMenu } from '../components/detail/InstallMenu'
import { SectionNav, type SectionId } from '../components/detail/SectionNav'
import { ToolsSection } from '../components/detail/ToolsSection'
import { useI18n } from '../i18n/context'
import type { ServerDetail as Detail, ServerItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { commentCount } from '../lib/comments'
import { daysSince, developerOf } from '../lib/entity'
import type { Route } from './+types/ServerDetail'

const IDS: SectionId[] = ['overview', 'config', 'tools', 'readme', 'comments']
const offset = () => (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 110) + 56

/** 配置里用的服务名：去掉常见的 -mcp / mcp- 前后缀 */
const configKey = (slug: string) => slug.replace(/^mcp-server-|^mcp-|-mcp-server$|-mcp$/g, '') || slug

/** 滚动时高亮当前所在区块 */
function useActiveSection(dep: unknown) {
  const [active, setActive] = useState<SectionId>('overview')
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({})
  useEffect(() => {
    const onScroll = () => {
      const y = offset() + 8
      let cur: SectionId = 'overview'
      for (const id of IDS) {
        const el = refs.current[id]
        if (el && el.getBoundingClientRect().top <= y) cur = id
      }
      setActive(cur)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [dep])
  const jump = (id: SectionId) => {
    const el = refs.current[id]
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset(), behavior: 'smooth' })
  }
  const reg = (id: SectionId) => (el: HTMLElement | null) => {
    refs.current[id] = el
  }
  return { active, jump, reg }
}

function Sidebar({ s, related }: { s: Detail; related: ServerItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.detail.infoKeys
  const updated = daysSince(s.lastCommitAt)
  return (
    <>
      <RelatedSection kind="server" title={m.detail.related} items={related} allLabel={tr(categoryOf('server', s.category?.slug).name)} />
      <InfoSection
        kind="server"
        d={s}
        rows={[
          { icon: Scales, label: k.license, value: s.license },
          { icon: User, label: k.author, value: developerOf(s) },
          { icon: Code, label: k.language, value: s.runtime },
          { icon: Tag, label: k.version, value: s.version },
          { icon: PlugsConnected, label: m.client.infoKeys.transports, value: s.transports.join(' · ') },
          { icon: CalendarBlank, label: k.added, value: fmt(s.source.sourceCreatedAt) },
          { icon: ClockCounterClockwise, label: k.updated, value: updated === null ? null : m.detail.ago(updated) },
          { icon: Certificate, label: k.registry, value: s.registryName && <span className="font-mono text-xs" title={s.registryName}>{s.registryName}</span> },
          { icon: Stack, label: k.sources, value: sourcesValue(s.allLinks, m.detail.sourceNames) },
        ]}
      />
    </>
  )
}

function Page({ s, related }: { s: Detail; related: ServerItem[] }) {
  const { m } = useI18n()
  const { active, jump, reg } = useActiveSection(s.slug)
  const remote = s.remotes[0]
  const key = configKey(s.slug)
  const glow = categoryOf('server', s.category?.slug).color
  return (
    <>
      <DetailSeo kind="server" d={s} section={m.dir.title} />
      <EntityHeader
        kind="server"
        d={s}
        listTitle={m.dir.title}
        badges={s.isRemote ? <Badge tone="blue" icon={CloudArrowUp}>{m.detail.kind.remote}</Badge> : <Badge tone="gray" icon={Desktop}>{m.detail.kind.local}</Badge>}
        actions={
          <>
            <DefaultActions d={s} />
            {remote && <InstallMenu name={key} url={remote.url} transport={remote.transport} />}
          </>
        }
      />
      <SectionNav active={active} toolCount={s.tools.length} commentCount={commentCount(`server:${s.slug}`)} onJump={jump} />
      <DetailBody
        main={
          <>
            <section ref={reg('overview')}><AboutSection d={s} /></section>
            <section ref={reg('config')}>
              <h2 className="text-xl font-bold tracking-tight">{m.detail.config}</h2>
              <p className="mb-4 mt-1.5 text-sm text-text2">{remote ? m.detail.configSubRemote : m.detail.configSubLocal}</p>
              <ConfigSection configKey={key} d={s} glow={glow} />
            </section>
            <section ref={reg('tools')}>
              <ToolsSection key={s.slug} slug={s.slug} remote={!!remote} stored={s.tools} storedAt={s.source.fetchedAt} />
            </section>
            <section ref={reg('readme')}><ReadmeSection d={s} /></section>
            <section ref={reg('comments')}><Comments key={s.slug} target={`server:${s.slug}`} /></section>
          </>
        }
        aside={<Sidebar s={s} related={related} />}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('server', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.detail.notFound} listHref="/servers" />
}

export default function ServerDetail({ loaderData }: Route.ComponentProps) {
  return <Page s={loaderData.d} related={loaderData.related} />
}
