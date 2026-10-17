import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, CalendarBlank, Check, Clock, Eye, LinkSimple, ShareNetwork, Translate } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { BlogCover } from '../components/blog/BlogCover'
import { BlogMarkdown } from '../components/blog/BlogMarkdown'
import { copyText } from '../components/detail/CopyButton'
import { EntityIcon } from '../components/EntityIcon'
import { Seo } from '../components/Seo'
import { useEnterAnimation, useHydrated } from '../fx/hydration'
import { useI18n } from '../i18n/context'
import { LOCALE_META, LOCALES } from '../i18n/locales'
import { ROUTE } from '../lib/api/entities'
import { sendBlogView, type BlogCard, type BlogPost as Post } from '../lib/api/blog'
import { loadBlogPost } from '../lib/api/loaders'
import { blogDate, coverStyle, tableOfContents, type TocItem } from '../lib/blog'
import { absoluteUrl, clip } from '../lib/seo'
import type { Route } from './+types/BlogPost'

export const loader = (args: Route.LoaderArgs) => loadBlogPost(args)

const compactNumber = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

/** 目录高亮：滚动时取已经滚过页面上方 160px 的最后一个标题 */
function useActiveHeading(toc: TocItem[]) {
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null)
  useEffect(() => {
    if (!toc.length) return
    const onScroll = () => {
      let current = toc[0]!.id
      for (const item of toc) {
        const el = document.getElementById(item.id)
        if (el && el.getBoundingClientRect().top < 160) current = item.id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [toc])
  return active
}

function ShareButtons({ post }: { post: Post }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  // 系统分享面板只在浏览器里判断（服务端渲染时没有 navigator）
  const canShare = useHydrated() && typeof navigator.share === 'function'
  const url = absoluteUrl(post.locale, `/blog/${post.slug}`)
  const btn = 'flex h-[34px] items-center gap-1.5 rounded-lg border border-line bg-fg/[0.03] px-3 text-[13px] transition-colors hover:border-fg/25'
  return (
    <div className="flex gap-2">
      <button
        onClick={async () => {
          await copyText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        className={clsx(btn, copied && 'text-accent')}
      >
        {copied ? <Check size={14} weight="bold" /> : <LinkSimple size={14} className="text-text2" />}
        {copied ? m.blog.copied : m.blog.copyLink}
      </button>
      {canShare && (
        <button onClick={() => navigator.share({ title: post.title, text: post.summary, url }).catch(() => {})} className={btn}>
          <ShareNetwork size={14} className="text-text2" />
          {m.blog.share}
        </button>
      )}
    </div>
  )
}

function RelatedCard({ post }: { post: BlogCard }) {
  const { m, to } = useI18n()
  const { color } = coverStyle(post.slug)
  return (
    <Link
      to={to(`/blog/${post.slug}`)}
      className="group flex flex-col gap-3 rounded-xl border border-line p-5 transition-colors hover:border-fg/20"
      style={{ background: `radial-gradient(120% 140% at 100% 0%, ${color}22, transparent 60%), var(--color-bg)` }}
    >
      {post.tags.length > 0 && <span className="truncate font-mono text-xs text-text3">{post.tags.slice(0, 3).map((t) => `#${t}`).join('  ')}</span>}
      <span className="line-clamp-2 text-base font-semibold leading-normal transition-colors group-hover:text-accent">{post.title}</span>
      <span className="font-mono text-xs text-text3">
        {blogDate(post.publishedAt)} · {m.blog.minutes(post.readingMinutes)}
      </span>
    </Link>
  )
}

/** 博客文章：正文 Markdown + 目录 + 文中提到的服务 + 上下篇 + 相关文章 */
export default function BlogPost({ loaderData: post }: Route.ComponentProps) {
  const { m, to, locale } = useI18n()
  const t = m.blog
  const enter = useEnterAnimation()
  const toc = useMemo(() => tableOfContents(post.body), [post.body])
  const active = useActiveHeading(toc)
  const published = blogDate(post.publishedAt)
  const updated = blogDate(post.updatedAt)

  useEffect(() => {
    void sendBlogView(post.slug)
  }, [post.slug])

  const path = `/blog/${post.slug}`
  const versions = LOCALES.filter((l) => l === 'zh' || post.translations.includes(l))
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: clip(post.summary) ?? undefined,
    url: absoluteUrl(post.locale, path),
    mainEntityOfPage: absoluteUrl(post.locale, path),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    inLanguage: LOCALE_META[post.locale].htmlLang,
    keywords: post.tags.join(', ') || undefined,
    image: post.coverUrl ?? undefined,
    author: { '@type': 'Person', name: post.authorName },
    publisher: { '@type': 'Organization', name: 'MCP Field', url: absoluteUrl('zh', '/') },
  }

  return (
    <>
      {/* hreflang 只列有译文的语言；还没翻译、显示中文原文的英文日文页面不收录，避免重复内容 */}
      <Seo title={`${post.title} · MCP Field`} description={post.summary} path={path} image={post.coverUrl} type="article" noindex={post.locale !== locale} locales={versions} jsonLd={jsonLd} />
      <header className="border-b border-line" style={{ background: 'radial-gradient(60% 220% at 20% 0%, #2B7FFF1F, transparent 60%), radial-gradient(40% 200% at 85% 0%, #3DDC9714, transparent 60%)' }}>
        <motion.div initial={enter ? { opacity: 0, y: 14 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="mx-auto flex max-w-[1248px] flex-col gap-4 px-6 pb-9 pt-10">
          <nav aria-label="breadcrumb" className="flex items-center gap-2 text-[13px] text-text3">
            <Link to={to('/blog')} className="hover:text-ink">{t.title}</Link>
          </nav>
          <h1 className="max-w-[880px] text-[30px] font-bold leading-[1.3] tracking-[-0.02em] sm:text-[38px]">{post.title}</h1>
          {post.summary && <p className="max-w-[760px] text-base leading-[1.7] text-text2">{post.summary}</p>}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-text2">
              <span className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-[13px] font-semibold text-accent">{post.authorName.slice(0, 1).toUpperCase()}</span>
                <span className="font-semibold text-ink">{post.authorName}</span>
              </span>
              <span className="hidden h-6 w-px bg-fg/[0.08] sm:block" />
              <span className="flex items-center gap-1.5"><CalendarBlank size={14} className="text-text3" /><time dateTime={post.publishedAt} className="font-mono">{published}</time></span>
              {updated > published && <span className="text-text3">{t.updated(updated.slice(5))}</span>}
              <span className="flex items-center gap-1.5"><Clock size={14} className="text-text3" />{t.readTime(post.readingMinutes)}</span>
              {post.views > 0 && <span className="flex items-center gap-1.5"><Eye size={14} className="text-text3" /><span className="font-mono">{compactNumber(post.views)}</span></span>}
            </div>
            <ShareButtons post={post} />
          </div>
        </motion.div>
      </header>

      <div className="mx-auto grid max-w-[1248px] gap-12 px-6 pb-16 pt-10 lg:grid-cols-[minmax(0,1fr)_264px] lg:gap-24">
        <article className="flex min-w-0 flex-col gap-8">
          {locale !== 'zh' && post.locale === 'zh' && (
            <p className="flex items-center gap-2 rounded-lg border border-line bg-fg/[0.03] px-4 py-3 text-[13px] text-text2"><Translate size={15} className="shrink-0 text-text3" />{t.zhOnlyPost}</p>
          )}
          {post.translation?.outdated && (
            <p className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/[0.06] px-4 py-3 text-[13px] text-text2"><Translate size={15} className="shrink-0 text-gold" />{t.outdated}</p>
          )}
          {post.coverUrl && <BlogCover post={post} large className="aspect-[16/9] rounded-2xl" />}
          {/* 没有译文时正文是中文原文，标明语言 */}
          <div lang={post.locale === 'zh' ? 'zh-CN' : undefined}>
            <BlogMarkdown source={post.body} />
          </div>

          <footer className="flex flex-col gap-6 border-t border-line pt-7">
            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Link key={tag} to={to(`/blog?tag=${encodeURIComponent(tag)}`)} className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-text2 transition-colors hover:border-fg/25 hover:text-ink">#{tag}</Link>
                ))}
              </div>
            )}
            {(post.older || post.newer) && (
              <nav className="grid gap-4 sm:grid-cols-2">
                {post.older ? (
                  <Link to={to(`/blog/${post.older.slug}`)} className="group flex flex-col gap-2 rounded-xl border border-line px-5 py-4 transition-colors hover:border-fg/20">
                    <span className="flex items-center gap-1.5 text-xs text-text3"><ArrowLeft size={13} />{t.prev}</span>
                    <span className="line-clamp-2 text-[15px] font-semibold leading-normal transition-colors group-hover:text-accent">{post.older.title}</span>
                  </Link>
                ) : <span className="hidden sm:block" />}
                {post.newer && (
                  <Link to={to(`/blog/${post.newer.slug}`)} className="group flex flex-col items-end gap-2 rounded-xl border border-line px-5 py-4 text-right transition-colors hover:border-fg/20">
                    <span className="flex items-center gap-1.5 text-xs text-text3">{t.next}<ArrowRight size={13} /></span>
                    <span className="line-clamp-2 text-[15px] font-semibold leading-normal transition-colors group-hover:text-accent">{post.newer.title}</span>
                  </Link>
                )}
              </nav>
            )}
          </footer>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-[132px] flex max-h-[calc(100vh-150px)] flex-col gap-8 overflow-y-auto pb-6 [scrollbar-width:none]">
            {toc.length > 0 && (
              <nav aria-label={t.toc}>
                <h2 className="mb-3 text-xs font-semibold tracking-wide text-text3">{t.toc}</h2>
                <ol className="border-l border-line">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={clsx('-ml-px block border-l-2 py-1.5 text-[13px] leading-normal transition-colors', item.level === 3 ? 'pl-7' : 'pl-3.5', active === item.id ? 'border-accent font-semibold text-accent' : clsx('border-transparent hover:text-ink', item.level === 3 ? 'text-text3' : 'text-text2'))}
                      >
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            {post.mentions.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold tracking-wide text-text3">{t.mentioned}</h2>
                <ul className="flex flex-col gap-2">
                  {post.mentions.map((it) => (
                    <li key={`${it.kind}/${it.slug}`}>
                      <Link to={to(`/${ROUTE[it.kind]}/${it.slug}`)} className="group flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5 transition-colors hover:border-fg/20">
                        <EntityIcon name={it.name} src={it.iconUrl} color="#3A3F47" size={32} className="rounded-lg" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{it.name}</span>
                          <span className="block text-xs text-text3">
                            {m.tags.kinds[it.kind]}
                            {it.popularity ? ` · ${compactNumber(it.popularity)}` : ''}
                          </span>
                        </span>
                        <ArrowUpRight size={14} className="text-text3 transition-colors group-hover:text-ink" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex w-fit items-center gap-1.5 text-[13px] text-text3 transition-colors hover:text-ink">
              <ArrowUp size={14} />
              {t.backToTop}
            </button>
          </div>
        </aside>
      </div>

      {post.related.length > 0 && (
        <section className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-5 px-6 pb-16 pt-11">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">{t.related}</h2>
              <Link to={to('/blog')} className="flex items-center gap-1.5 text-[13px] text-text2 transition-colors hover:text-ink">{t.allPosts}<ArrowRight size={14} /></Link>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {post.related.map((p) => <RelatedCard key={p.slug} post={p} />)}
            </div>
          </div>
        </section>
      )}
    </>
  )
}
