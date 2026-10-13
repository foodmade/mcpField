import { motion } from 'motion/react'
import {
  ArrowRight, ArrowUpRight, BookmarkSimple, BookOpen, CaretRight, ChatCenteredText, CheckCircle, ClockCounterClockwise,
  GithubLogo, Globe, ShareNetwork, ShieldCheck, Sparkle, WarningCircle, type Icon,
} from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { useEnterAnimation } from '../../fx/hydration'
import { RevealGroup, RevealItem } from '../../fx/Reveal'
import { SpotlightCard } from '../../fx/SpotlightCard'
import { useI18n } from '../../i18n/context'
import { LOCALE_META } from '../../i18n/locales'
import { ROUTE, type BaseItem, type DetailBase, type Kind } from '../../lib/api/entities'
import { categoryOf } from '../../lib/categories'
import { daysSince, developerOf, domainOf } from '../../lib/entity'
import { absoluteUrl } from '../../lib/seo'
import { parseJson, useStorage } from '../../lib/storage'
import { EntityIcon } from '../EntityIcon'
import { ErrorPage } from '../ErrorPage'
import { FaqSection } from '../Faq'
import { Seo } from '../Seo'
import { Stars } from '../directory/ServerItems'
import { AiOverview } from './AiOverview'
import { copyText } from './CopyButton'
import { MarkdownReadme } from './MarkdownReadme'

/*
 * 各类型详情页共用的部件：SEO 标签、错误页、头部、关于、README、同类推荐、基本信息。
 * 数据由各详情页的 loader 在服务端取回（lib/api/loaders 的 loadDetail），每个详情页只负责组合这些部件，
 * 并补上自己类型特有的区块。
 */

const ease = [0.22, 1, 0.36, 1] as const
const BM_KEY = 'mcpfield.bookmarks'

/** 详情页的错误边界：不存在时显示该类型的"找不到"文案（状态码 404），其余错误可重试 */
export function DetailError({ notFound, listHref }: { notFound: { title: string; hint: string; back: string }; listHref: string }) {
  return <ErrorPage notFound={notFound} backHref={listHref} />
}

/**
 * 详情页的 SEO 标签与结构化数据（SoftwareApplication + 面包屑）。
 * 描述优先用 AI 介绍的概述，其次是简介。
 */
export function DetailSeo({ kind, d, section }: { kind: Kind; d: BaseItem & DetailBase; section: string }) {
  const { m, locale } = useI18n()
  const path = `/${ROUTE[kind]}/${d.slug}`
  const description = d.overview?.summary ?? d.tagline ?? `${d.name} · ${section}`
  const author = d.author && { '@type': d.author.role === 'vendor' ? 'Organization' : 'Person', name: developerOf(d), ...(d.author.url ? { url: d.author.url } : {}) }
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: d.name,
        description: d.overview?.summary ?? d.tagline ?? undefined,
        url: absoluteUrl(locale, path),
        applicationCategory: 'DeveloperApplication',
        inLanguage: LOCALE_META[locale].htmlLang,
        ...(d.iconUrl ? { image: d.iconUrl } : {}),
        ...(author ? { author } : {}),
        ...(d.license ? { license: d.license } : {}),
        ...(d.tags.length ? { keywords: d.tags.join(', ') } : {}),
        sameAs: [d.links.website, d.links.repository].filter(Boolean),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: m.dir.crumb, item: absoluteUrl(locale, '/') },
          { '@type': 'ListItem', position: 2, name: section, item: absoluteUrl(locale, `/${ROUTE[kind]}`) },
          { '@type': 'ListItem', position: 3, name: d.name, item: absoluteUrl(locale, path) },
        ],
      },
    ],
  }
  return <Seo title={`${d.name} · ${section} · MCP Field`} description={description} path={path} image={d.iconUrl} type="article" jsonLd={jsonLd} />
}

export const Badge = ({ tone, icon: I, children }: { tone: 'green' | 'gold' | 'blue' | 'violet' | 'gray'; icon: Icon; children: ReactNode }) => {
  const cls = {
    green: 'border-accent/25 bg-accent/10 text-mint',
    gold: 'border-[#F2C94C]/25 bg-[#F2C94C]/10 text-gold',
    blue: 'border-[#2B7FFF]/30 bg-[#2B7FFF]/10 text-sky',
    violet: 'border-[#A78BFA]/30 bg-[#A78BFA]/10 text-violet',
    gray: 'border-fg/15 bg-fg/[0.05] text-text2',
  }[tone]
  return (
    <span className={clsx('flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', cls)}>
      <I size={13} weight={tone === 'gold' ? 'fill' : 'regular'} />
      {children}
    </span>
  )
}

/** 头部右侧的外链按钮 */
export function LinkButton({ href, icon: I, label }: { href: string; icon: Icon; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-fg/[0.12] bg-fg/[0.04] px-3 text-sm transition-colors hover:border-fg/25 hover:bg-fg/[0.07]">
      <I size={15} className="text-text2" />{label}
      <ArrowUpRight size={12} className="text-text3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  )
}

/** 默认的头部按钮：文档、代码仓库、官网（主按钮） */
export function DefaultActions({ d }: { d: BaseItem }) {
  const { m } = useI18n()
  const { website, repository, docs } = d.links
  return (
    <>
      {docs && <LinkButton href={docs} icon={BookOpen} label={m.detail.links.docs} />}
      {website && repository && <LinkButton href={repository} icon={GithubLogo} label={m.detail.links.repo} />}
      {(website ?? repository) && (
        <motion.a href={(website ?? repository)!} target="_blank" rel="noreferrer" whileTap={{ scale: 0.96 }} className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-6px_#3DDC9780]">
          {website ? <><Globe size={15} weight="bold" />{m.client.visit}</> : <><GithubLogo size={15} weight="bold" />{m.detail.links.repo}</>}
        </motion.a>
      )}
    </>
  )
}

/** 详情页头部：面包屑、图标、名称与标识、元信息、操作按钮 */
export function EntityHeader({
  kind,
  d,
  listTitle,
  badges,
  meta,
  actions,
  tile,
}: {
  kind: Kind
  d: BaseItem
  listTitle: string
  /** 名称后面额外的标识 */
  badges?: ReactNode
  /** 元信息行额外的项目 */
  meta?: ReactNode
  /** 右侧操作；默认是文档、仓库、官网 */
  actions?: ReactNode
  /** 自定义图标 */
  tile?: ReactNode
}) {
  const { m, tr, to } = useI18n()
  const enter = useEnterAnimation()
  const cat = categoryOf(kind, d.category?.slug)
  const days = daysSince(d.lastCommitAt)
  const sub = domainOf(d) ?? developerOf(d)
  return (
    <section style={{ background: `radial-gradient(50% 240% at 15% 0%, ${cat.color}26, transparent 60%), radial-gradient(40% 200% at 70% 0%, #2B7FFF1F, transparent 60%)` }}>
      <div className="mx-auto max-w-[1248px] px-6 pb-10 pt-7">
        <div className="flex items-center justify-between gap-4">
          <nav aria-label={m.dir.breadcrumb} className="flex min-w-0 items-center gap-1.5 text-sm text-text3">
            <Link to={to('/')} className="hover:text-ink">{m.dir.crumb}</Link>
            <CaretRight size={12} className="shrink-0" />
            <Link to={to(`/${ROUTE[kind]}`)} className="hover:text-ink">{listTitle}</Link>
            <CaretRight size={12} className="shrink-0" />
            <span className="truncate text-ink">{d.name}</span>
          </nav>
          <a href="#" className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-fg/[0.12] px-3 text-sm text-text2 transition-colors hover:border-fg/25 hover:text-ink">
            <ChatCenteredText size={14} />{m.detail.feedback}
          </a>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-5">
          <motion.div initial={enter ? { opacity: 0, scale: 0.6, rotate: -12 } : false} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
            {tile ?? <EntityIcon name={d.name} src={d.iconUrl} color={cat.color} size={72} className="!rounded-[18px] border border-fg/15 shadow-[0_12px_32px_rgba(255,255,255,0.08)]" />}
          </motion.div>
          <motion.div className="min-w-0 flex-1" initial={enter ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.05 }}>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{d.name}</h1>
              {d.official && <Badge tone="blue" icon={ShieldCheck}>{m.dir.official}</Badge>}
              {d.verified && <Badge tone="green" icon={CheckCircle}>{m.dir.verified}</Badge>}
              {d.featured && <Badge tone="gold" icon={Sparkle}>{m.dir.featured}</Badge>}
              {badges}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-text2">
              {sub && <><span>@{sub}</span><span className="h-3.5 w-px bg-fg/[0.12]" /></>}
              <Link to={to(`/${ROUTE[kind]}?category=${cat.slug}`)} className="flex items-center gap-1 hover:text-ink"><cat.icon size={14} style={{ color: cat.color }} />{tr(cat.name)}</Link>
              <Stars n={d.stars} />
              {meta}
              {days !== null && <span className="flex items-center gap-1"><ClockCounterClockwise size={14} />{m.dir.updated(days)}</span>}
            </div>
          </motion.div>
          <motion.div className="flex flex-wrap items-center gap-2" initial={enter ? { opacity: 0, y: 12 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.12 }}>
            {actions ?? <DefaultActions d={d} />}
          </motion.div>
        </div>
      </div>
    </section>
  )
}

/**
 * "关于"区块：有 AI 介绍时显示介绍，否则显示简介；下面是标签。
 * summaryOnly：只显示概述，主要功能和适用场景由页面自己单独展示
 */
export function AboutSection({ d, summaryOnly }: { d: BaseItem & DetailBase; summaryOnly?: boolean }) {
  const { m } = useI18n()
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">{m.detail.about(d.name)}</h2>
      {d.overview ? (
        <AiOverview overview={d.overview} summaryOnly={summaryOnly} />
      ) : (
        <p className={clsx('mt-4 text-[15px] leading-[1.75]', d.tagline ? 'text-text2' : 'text-text3')}>{d.tagline ?? m.client.noTagline}</p>
      )}
      {d.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {d.tags.map((t) => <span key={t} className="rounded-lg border border-fg/[0.08] bg-fg/[0.04] px-2.5 py-1 text-xs text-text2">#{t}</span>)}
        </div>
      )}
    </section>
  )
}

/** README（原文 / AI 译文切换）；没有 README 时显示提示 */
export function ReadmeSection({ d, empty }: { d: BaseItem & DetailBase; empty?: string }) {
  const { m, locale } = useI18n()
  if (!d.readme) {
    return (
      <div>
        <h2 className="mb-5 border-b border-line pb-3 text-xl font-bold tracking-tight">{m.detail.readme}</h2>
        <p className="text-[15px] leading-[1.75] text-text3">{empty ?? m.detail.noReadme}</p>
      </div>
    )
  }
  return <MarkdownReadme key={`${d.slug}:${locale}`} content={d.readme.content} format={d.readme.format} base={d.readme.baseUrl} translation={d.readmeTranslation} />
}

/** 侧栏"同类推荐"：同分类按热度取前几个（由详情页 loader 一并取回） */
export function RelatedSection<T extends BaseItem>({ kind, items, title, allLabel, footer }: { kind: Kind; items: T[]; title: string; allLabel: string; footer?: (r: T) => ReactNode }) {
  const { to } = useI18n()
  if (items.length === 0) return null
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-text2"><Sparkle size={14} weight="fill" className="text-accent" />{title}</h2>
        <Link to={to(`/${ROUTE[kind]}`)} className="group flex items-center gap-1 text-xs text-text3 hover:text-ink">{allLabel}<ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></Link>
      </div>
      <RevealGroup className="flex flex-col gap-3" stagger={0.06}>
        {items.map((r) => {
          const cat = categoryOf(kind, r.category?.slug)
          return (
            <RevealItem key={r.slug}>
              <SpotlightCard glow={cat.color} className="flex flex-col gap-2.5 p-[18px]">
                <Link to={to(`/${ROUTE[kind]}/${r.slug}`)} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={r.name} />
                <div className="flex items-center gap-3">
                  <EntityIcon name={r.name} src={r.iconUrl} color={cat.color} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold"><span className="truncate">{r.name}</span>{r.verified && <CheckCircle size={14} className="shrink-0 text-accent" />}</div>
                    <div className="truncate text-xs text-text3">{domainOf(r) ?? developerOf(r)}</div>
                  </div>
                  <Stars n={r.stars} />
                </div>
                {r.tagline && <p className="line-clamp-2 text-sm leading-relaxed text-text2">{r.tagline}</p>}
                {footer?.(r)}
              </SpotlightCard>
            </RevealItem>
          )
        })}
      </RevealGroup>
    </section>
  )
}

export type InfoRow = { icon: Icon; label: string; value: ReactNode }

/** 侧栏"基本信息"和分享、收藏、报告问题按钮；值为空的行自动隐藏 */
/** 收录来源：合并后的条目可能同时来自多个数据源，列出各来源的条目链接；只显示已知的数据源 */
export function SourceLinks({ links }: { links: { type: string; url: string; label: string | null }[] }) {
  const { m } = useI18n()
  const sources = links.filter((l) => l.type === 'source' && l.label && m.detail.sourceNames[l.label])
  if (sources.length === 0) return null
  return (
    <span className="flex flex-wrap justify-end gap-x-2.5">
      {sources.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="hover:text-accent">{m.detail.sourceNames[l.label!]}</a>
      ))}
    </span>
  )
}

/** 有已知来源链接时返回"收录来源"的显示内容，没有时为 null（信息栏会隐藏这一行） */
export const sourcesValue = (links: { type: string; url: string; label: string | null }[], known: Record<string, string>) =>
  links.some((l) => l.type === 'source' && l.label && known[l.label]) ? <SourceLinks links={links} /> : null

export function InfoSection({ kind, d, rows }: { kind: Kind; d: BaseItem; rows: InfoRow[] }) {
  const { m } = useI18n()
  const [shared, setShared] = useState(false)
  const key = `${kind}:${d.slug}`
  const [raw, setRaw] = useStorage(BM_KEY)
  const saved = parseJson<string[]>(raw, []).includes(key)
  const toggleSave = () => {
    const list = new Set(parseJson<string[]>(raw, []))
    if (list.has(key)) list.delete(key)
    else list.add(key)
    setRaw(JSON.stringify([...list]))
  }
  const visible = rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== '')
  const btn = 'flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border text-xs transition-colors'
  const report = d.links.repository ? `${d.links.repository}/issues` : 'mailto:hello@mcpfield.dev'
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-text2">{m.detail.info}</h2>
      {visible.length > 0 && (
        <dl className="rounded-2xl border border-fg/[0.08] bg-surface px-[18px] py-1">
          {visible.map(({ icon: I, label, value }, i) => (
            <div key={label} className={clsx('flex items-center gap-3 py-3', i > 0 && 'border-t border-fg/[0.06]')}>
              <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-fg/[0.04] text-text2"><I size={15} /></span>
              <dt className="shrink-0 text-sm text-text3">{label}</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-sm font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex gap-2">
        <button onClick={() => { copyText(location.href); setShared(true); setTimeout(() => setShared(false), 1600) }} className={clsx(btn, shared ? 'border-accent/40 text-accent' : 'border-fg/10 text-text2 hover:text-ink')}>
          <ShareNetwork size={14} />{shared ? m.detail.shared : m.detail.share}
        </button>
        <button onClick={toggleSave} aria-pressed={saved} className={clsx(btn, saved ? 'border-[#F2C94C]/40 text-gold' : 'border-fg/10 text-text2 hover:text-ink')}>
          <BookmarkSimple size={14} weight={saved ? 'fill' : 'regular'} />{saved ? m.detail.bookmarked : m.detail.bookmark}
        </button>
        <a href={report} target="_blank" rel="noreferrer" className={clsx(btn, 'border-fg/10 text-text2 hover:text-ink')}><WarningCircle size={14} />{m.detail.report}</a>
      </div>
    </section>
  )
}

/** 日期格式化（随界面语言）；固定按 UTC 日期，服务端和浏览器输出一致 */
export function useDateFormat() {
  const { locale } = useI18n()
  return (iso: string | null) => (iso ? new Intl.DateTimeFormat(LOCALE_META[locale].htmlLang, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso)) : null)
}

/** 详情页主体：左侧内容 + 右侧栏，底部 FAQ */
export function DetailBody({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <>
      <div className="border-t border-line">
        <div className="mx-auto grid max-w-[1248px] gap-12 px-6 pb-24 pt-10 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
          <div className="flex flex-col gap-14">{main}</div>
          <aside className="flex flex-col gap-9">{aside}</aside>
        </div>
      </div>
      <div className="border-t border-line">
        <FaqSection />
      </div>
    </>
  )
}
