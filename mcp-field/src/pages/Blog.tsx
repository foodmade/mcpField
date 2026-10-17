import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Notebook, PushPin, RssSimple, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Link, useLocation, useNavigate, useNavigation, type To } from 'react-router'
import { BlogCover } from '../components/blog/BlogCover'
import { SearchBox } from '../components/directory/Sidebar'
import { Seo } from '../components/Seo'
import { useEnterAnimation } from '../fx/hydration'
import { useI18n } from '../i18n/context'
import type { BlogCard } from '../lib/api/blog'
import { loadBlogList, parseBlogQuery } from '../lib/api/loaders'
import { blogDate } from '../lib/blog'
import { absoluteUrl } from '../lib/seo'
import type { Route } from './+types/Blog'

export const loader = (args: Route.LoaderArgs) => loadBlogList(args)

const PATH = '/blog'
const fmt = (n: number) => n.toLocaleString('en-US')

type Query = ReturnType<typeof parseBlogQuery>

/** 列表页的查询串：去掉默认值，键按固定顺序 */
const searchOf = (q: Partial<Query>) => {
  const sp = new URLSearchParams()
  if (q.tag) sp.set('tag', q.tag)
  if (q.q) sp.set('q', q.q)
  if (q.page && q.page > 1) sp.set('page', String(q.page))
  return sp.toString()
}
const to = (q: Partial<Query>): To => {
  const s = searchOf(q)
  return { search: s ? `?${s}` : '' }
}

/** 英文、日文页面上还没有译文、显示中文的文章：标一个“中文” */
function ZhBadge({ post }: { post: BlogCard }) {
  const { m, locale } = useI18n()
  if (locale === 'zh' || post.locale !== 'zh') return null
  return <span className="rounded border border-line px-1.5 py-px text-[10px] text-text3">{m.blog.zhBadge}</span>
}

function Author({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{name.slice(0, 1).toUpperCase()}</span>
      <span className="text-ink">{name}</span>
    </span>
  )
}

/** 置顶文章：大封面 + 标题摘要 */
function Pinned({ post }: { post: BlogCard }) {
  const { m, to: href } = useI18n()
  const t = m.blog
  return (
    <Link to={href(`/blog/${post.slug}`)} className="group grid items-center gap-8 lg:grid-cols-[minmax(0,620px)_1fr] lg:gap-10">
      <div className="relative">
        <BlogCover post={post} large className="aspect-[16/9] rounded-2xl transition-[border-color] group-hover:border-fg/20" />
        <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent backdrop-blur">
          <PushPin size={12} weight="fill" />
          {t.pinned}
        </span>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 text-[13px]">
          <time dateTime={post.publishedAt} className="font-mono text-text3">{blogDate(post.publishedAt)}</time>
          {post.tags.slice(0, 3).map((tag) => <span key={tag} className="font-mono text-xs text-text3">#{tag}</span>)}
          <ZhBadge post={post} />
        </div>
        <h2 className="text-[26px] font-bold leading-snug tracking-[-0.01em] transition-colors group-hover:text-accent sm:text-[30px]">{post.title}</h2>
        {post.summary && <p className="line-clamp-3 text-[15px] leading-[1.75] text-text2">{post.summary}</p>}
        <div className="flex items-center justify-between pt-2 text-[13px]">
          <Author name={post.authorName} />
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            {t.readMore}
            <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/** 列表里的一篇：日期 · 内容 · 缩略图 */
function Row({ post, q }: { post: BlogCard; q: Query }) {
  const { to: href, locale } = useI18n()
  const [y, mo, d] = blogDate(post.publishedAt).split('-')
  return (
    <article className="group relative flex gap-5 border-b border-line py-6 last:border-0 sm:gap-7">
      <time dateTime={post.publishedAt} className="hidden w-16 shrink-0 flex-col gap-0.5 sm:flex">
        <span className="font-mono text-lg font-semibold tracking-[-0.02em] text-ink">{mo}.{d}</span>
        <span className="font-mono text-xs text-text3">{y}</span>
      </time>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {/* 手机上日期列隐藏，日期放在这一行；英文日文页面没有译文的文章在这里标“中文” */}
        <div className={clsx('flex items-center gap-2 text-xs', (locale === 'zh' || post.locale !== 'zh') && 'sm:hidden')}>
          <span className="font-mono text-text3 sm:hidden">{blogDate(post.publishedAt)}</span>
          <ZhBadge post={post} />
        </div>
        <h3 className="text-[19px] font-semibold leading-[1.45] transition-colors group-hover:text-accent">
          {/* 整行可点：链接的点击区域铺满整篇 */}
          <Link to={href(`/blog/${post.slug}`)} className="after:absolute after:inset-0">{post.title}</Link>
        </h3>
        {post.summary && <p className="line-clamp-2 text-sm leading-[1.7] text-text2">{post.summary}</p>}
        {post.tags.length > 0 && (
          <div className="relative z-[1] flex flex-wrap gap-2 pt-1">
            {post.tags.map((tag) => (
              <Link key={tag} to={to({ ...q, tag, page: 1 })} preventScrollReset className={clsx('rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors', tag === q.tag ? 'bg-accent/15 text-accent' : 'bg-subtle text-text3 hover:text-ink')}>
                #{tag}
              </Link>
            ))}
          </div>
        )}
      </div>
      <BlogCover post={post} className="hidden aspect-[16/10] w-44 shrink-0 self-start rounded-[10px] transition-[border-color] group-hover:border-fg/20 sm:flex" />
    </article>
  )
}

function Pagination({ page, totalPages, q }: { page: number; totalPages: number; q: Query }) {
  const { m } = useI18n()
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const edge = 'flex items-center gap-1.5 text-[13px]'
  return (
    <nav aria-label="pagination" className="flex items-center justify-between border-t border-line pt-7">
      {page > 1 ? (
        <Link to={to({ ...q, page: page - 1 })} className={clsx(edge, 'text-ink hover:text-accent')}><ArrowLeft size={14} />{m.blog.newer}</Link>
      ) : (
        <span className={clsx(edge, 'text-text3 opacity-50')}><ArrowLeft size={14} />{m.blog.newer}</span>
      )}
      <div className="flex items-center gap-1">
        {pages.map((p, i) => (
          <span key={p} className="flex items-center gap-1">
            {i > 0 && p - pages[i - 1]! > 1 && <span className="px-1 text-text3">…</span>}
            <Link to={to({ ...q, page: p })} aria-current={p === page ? 'page' : undefined} className={clsx('flex size-8 items-center justify-center rounded-lg font-mono text-[13px]', p === page ? 'bg-ink font-semibold text-bg' : 'text-text2 hover:bg-fg/[0.06] hover:text-ink')}>
              {p}
            </Link>
          </span>
        ))}
      </div>
      {page < totalPages ? (
        <Link to={to({ ...q, page: page + 1 })} className={clsx(edge, 'text-ink hover:text-accent')}>{m.blog.older}<ArrowRight size={14} /></Link>
      ) : (
        <span className={clsx(edge, 'text-text3 opacity-50')}>{m.blog.older}<ArrowRight size={14} /></span>
      )}
    </nav>
  )
}

function Sidebar({ data, q }: { data: Route.ComponentProps['loaderData']; q: Query }) {
  const { m, locale } = useI18n()
  const t = m.blog
  const s = data.summary
  const h = 'mb-3.5 text-[13px] font-semibold'
  return (
    <aside className="flex flex-col gap-9 lg:pt-6">
      <section className="rounded-xl border border-line p-5" style={{ background: 'radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 60%), var(--color-surface)' }}>
        <h2 className={h}>{t.rss.title}</h2>
        <p className="text-[13px] leading-relaxed text-text2">{t.rss.hint}</p>
        <a href="/blog/rss.xml" className="mt-4 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-accent-ink transition-[filter] hover:brightness-110">
          <RssSimple size={15} weight="bold" />{t.rss.button}
        </a>
        {locale !== 'zh' && data.data.some((p) => p.locale === 'zh') && <p className="mt-3 text-[11px] leading-relaxed text-text3">{t.zhOnlyList}</p>}
      </section>
      {s.tags.length > 0 && (
        <section>
          <h2 className={h}>{t.tags}</h2>
          <div className="flex flex-wrap gap-2">
            {s.tags.map(({ tag, count }) => (
              <Link key={tag} to={to({ ...q, tag: tag === q.tag ? null : tag, page: 1 })} preventScrollReset title={String(count)} className={clsx('rounded-md border px-2.5 py-1 font-mono text-xs transition-colors', tag === q.tag ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-text2 hover:border-fg/25 hover:text-ink')}>
                #{tag}
              </Link>
            ))}
          </div>
        </section>
      )}
    </aside>
  )
}

/** 博客列表：栏目筛选、关键词、标签；第一页不筛选时置顶文章大图展示 */
export default function Blog({ loaderData: data }: Route.ComponentProps) {
  const { m, locale } = useI18n()
  const t = m.blog
  const enter = useEnterAnimation()
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const busy = navigation.state === 'loading' && navigation.location.pathname === location.pathname
  const q = parseBlogQuery(new URLSearchParams(location.search))
  const s = data.summary
  const filtered = !!(q.tag || q.q)
  const pinned = !filtered && q.page === 1 ? s.pinned : null
  const rows = pinned ? data.data.filter((p) => p.slug !== pinned.slug) : data.data
  // 列表上方的快捷标签：最常用的几个，加上当前筛选的标签（不在其中时）
  const quickTags = [...new Set([...s.tags.slice(0, 6).map((x) => x.tag), ...(q.tag ? [q.tag] : [])])]

  const canonical = searchOf({ ...q, q: '' })
  const title = [q.tag ? `#${q.tag}` : null, q.page > 1 ? m.dir.pageTitle(q.page) : null, t.seoTitle].filter(Boolean).join(' · ')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: t.seoTitle,
    url: absoluteUrl(locale, PATH),
    blogPost: data.data.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: absoluteUrl(p.locale, `/blog/${p.slug}`), datePublished: p.publishedAt, dateModified: p.updatedAt, author: { '@type': 'Person', name: p.authorName } })),
  }
  const stats = [
    [fmt(s.total), t.stats.posts, true],
    [fmt(s.tagCount), t.stats.tags, false],
    [s.latestAt ? blogDate(s.latestAt).slice(5).replace('-', '.') : '—', t.stats.updated, false],
  ] as const

  return (
    <>
      <Seo title={title} description={t.seoDesc} path={PATH} query={canonical} noindex={!!q.q} jsonLd={jsonLd} />
      <section className="relative overflow-hidden border-b border-fg/[0.04]" style={{ background: 'radial-gradient(60% 220% at 20% 0%, #2B7FFF1F, transparent 60%), radial-gradient(40% 200% at 85% 0%, #3DDC9714, transparent 60%)' }}>
        <motion.div
          initial={enter ? { opacity: 0, y: 14 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto flex max-w-[1248px] flex-wrap items-center justify-between gap-6 px-6 pb-7 pt-9"
        >
          <div>
            <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{t.title}</h1>
            <p className="mt-1.5 max-w-[620px] text-sm text-text2">{t.sub}</p>
          </div>
          <dl className="flex items-center gap-6 sm:gap-9">
            {stats.map(([v, label, accent], i) => (
              <div key={label} className={clsx('flex flex-col-reverse gap-1', i > 0 && 'border-l border-fg/[0.08] pl-6 sm:pl-9')}>
                <dt className="text-xs text-text3">{label}</dt>
                <dd className={clsx('font-mono text-[22px] font-semibold tabular-nums tracking-[-0.02em]', accent ? 'text-accent' : 'text-ink')}>{v}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </section>

      <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-6 pb-24 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line">
          <nav aria-label={t.tagsLabel} className="-mb-px flex max-w-full gap-7 overflow-x-auto [scrollbar-width:none]">
            {[null, ...quickTags].map((tag) => {
              const active = q.tag === tag
              return (
                <Link key={tag ?? 'all'} to={to({ ...q, tag, page: 1 })} preventScrollReset aria-current={active ? 'page' : undefined} className={clsx('flex shrink-0 items-center gap-1.5 border-b-2 pb-3 pt-1.5 text-sm transition-colors', active ? 'border-accent font-semibold text-ink' : 'border-transparent text-text2 hover:text-ink', tag && 'font-mono')}>
                  {tag ? `#${tag}` : t.all}
                  {!tag && <span className={clsx('font-mono text-xs font-normal', active ? 'text-accent' : 'text-text3')}>{s.total}</span>}
                </Link>
              )
            })}
          </nav>
          <div className="mb-3 w-full sm:w-[260px]">
            <SearchBox q={q.q} placeholder={t.searchPh} onQuery={(v) => navigate(to({ ...q, q: v, page: 1 }), { replace: true, preventScrollReset: true })} />
          </div>
        </div>

        {pinned && <Pinned post={pinned} />}

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-14">
          <div className={clsx('flex min-w-0 flex-col transition-opacity duration-200', busy && 'opacity-60')}>
            {q.tag && (
              <div className="flex items-center gap-2 pb-2 pt-2 text-[13px] text-text3">
                <Link to={to({ ...q, tag: null, page: 1 })} preventScrollReset className="flex h-7 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 font-mono text-accent" aria-label={t.clearFilter}>
                  #{q.tag}<X size={11} />
                </Link>
                {fmt(data.meta.total)}
              </div>
            )}
            {rows.length === 0 && !pinned ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-line px-6 text-center">
                <Notebook size={28} className="text-text3" />
                <h2 className="text-lg font-semibold">{filtered ? t.empty.title : t.empty.none}</h2>
                {filtered && (
                  <>
                    <p className="text-sm text-text2">{t.empty.hint}</p>
                    <Link to={to({})} className="mt-1 flex h-[38px] items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink">{t.empty.clear}</Link>
                  </>
                )}
              </div>
            ) : (
              rows.map((p) => <Row key={p.slug} post={p} q={q} />)
            )}
            {data.meta.totalPages > 1 && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} q={q} />}
          </div>
          <Sidebar data={data} q={q} />
        </div>
      </div>
    </>
  )
}
