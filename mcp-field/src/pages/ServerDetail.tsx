import { CalendarBlank, Certificate, ClockCounterClockwise, CloudArrowUp, Code, Desktop, PlugsConnected, Scales, Tag, User } from '@phosphor-icons/react'
import { Comments } from '../components/Comments'
import { ClaimButton, ClaimNotice } from '../components/detail/ClaimButton'
import { ConfigSection } from '../components/detail/ConfigSection'
import {
  AboutSection, Badge, DefaultActions, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, ReadmeSection, RelatedSection, useDateFormat,
} from '../components/detail/EntityDetail'
import { InstallMenu } from '../components/detail/InstallMenu'
import { SectionNav, useActiveSection } from '../components/detail/SectionNav'
import { ToolsSection } from '../components/detail/ToolsSection'
import { useI18n } from '../i18n/context'
import type { ServerDetail as Detail, ServerItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf } from '../lib/categories'
import { useClaim } from '../lib/claims'
import { useCommentCount } from '../lib/comments'
import { daysSince, developerOf } from '../lib/entity'
import type { Route } from './+types/ServerDetail'

const IDS = ['overview', 'config', 'tools', 'readme', 'comments'] as const

/** 配置里用的服务名：去掉常见的 -mcp / mcp- 前后缀 */
const configKey = (slug: string) => slug.replace(/^mcp-server-|^mcp-|-mcp-server$|-mcp$/g, '') || slug

function Sidebar({ s, related }: { s: Detail; related: ServerItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.detail.infoKeys
  const updated = daysSince(s.lastCommitAt)
  return (
    <>
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
        ]}
      />
      <RelatedSection kind="server" title={m.detail.related} items={related} allLabel={tr(categoryOf('server', s.category?.slug).name)} />
    </>
  )
}

function Page({ s, related }: { s: Detail; related: ServerItem[] }) {
  const { m } = useI18n()
  const { active, jump, reg } = useActiveSection(IDS, s.slug)
  const commentTotal = useCommentCount(`server:${s.slug}`)
  const claim = useClaim(s.slug)
  const remote = s.remotes[0]
  const key = configKey(s.slug)
  return (
    <>
      <DetailSeo kind="server" d={s} section={m.dir.title} />
      <EntityHeader
        kind="server"
        // 有效的认领也显示"已认证"（页面 HTML 有 CDN 缓存，刚认领完时以浏览器读到的状态为准）
        d={claim.status?.claim && !s.verified ? { ...s, verified: true } : s}
        listTitle={m.dir.title}
        badges={s.isRemote ? <Badge quiet tone="blue" icon={CloudArrowUp}>{m.detail.kind.remote}</Badge> : <Badge quiet tone="gray" icon={Desktop}>{m.detail.kind.local}</Badge>}
        actions={
          <>
            <ClaimButton status={claim.status} busy={claim.busy} onClaim={() => void claim.start()} />
            <DefaultActions d={s} />
            {remote && <InstallMenu name={key} url={remote.url} transport={remote.transport} />}
          </>
        }
      />
      <DetailBody
        nav={
          <SectionNav
            items={[
              { id: 'overview', label: m.detail.sections.overview },
              { id: 'config', label: m.detail.sections.config },
              { id: 'tools', label: m.detail.sections.tools, count: s.tools.length },
              { id: 'readme', label: m.detail.sections.readme },
              { id: 'comments', label: m.comments.title, count: commentTotal },
            ]}
            active={active}
            onJump={jump}
          />
        }
        main={
          <>
            <section ref={reg('overview')}><AboutSection d={s} /></section>
            <section ref={reg('config')}>
              <h2 className="text-xl font-bold tracking-tight">{m.detail.config}</h2>
              <p className="mb-4 mt-1.5 text-sm text-text2">{remote ? m.detail.configSubRemote : m.detail.configSubLocal}</p>
              <ConfigSection configKey={key} d={s} />
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
      <ClaimNotice result={claim.result} onDismiss={claim.dismiss} />
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
