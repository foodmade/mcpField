import { LayoutGroup, motion } from 'motion/react'
import { DownloadSimple, Star } from '@phosphor-icons/react'
import { useState } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { CountUp } from '../fx/CountUp'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import { fetchList, type ListParams, type ServerItem, type SkillItem } from '../lib/api/entities'
import { useApi } from '../lib/api/useApi'
import { categoryOf } from '../lib/categories'
import { developerOf, repoPath } from '../lib/entity'
import { EntityIcon } from './EntityIcon'
import { Container, LinkArrow } from './ui'

const MotionLink = motion.create(Link)
const panel = (glow: string) => ({ background: `radial-gradient(110% 130% at 100% 0%, ${glow}26, transparent 60%), var(--color-surface)` })
const spring = { type: 'spring', stiffness: 500, damping: 40 } as const

type RankTab = 'popular' | 'newest' | 'updated'
const TABS: RankTab[] = ['popular', 'newest', 'updated']
const SORT: Record<RankTab, NonNullable<ListParams['sort']>> = { popular: 'popular', newest: 'newest', updated: 'updated' }

function Heading({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex min-h-[58px] flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight md:text-[22px]">{title}</h2>
        <p className="mt-1 text-sm text-text3">{sub}</p>
      </div>
      {right}
    </div>
  )
}

const RowSkeleton = ({ n }: { n: number }) => (
  <>{Array.from({ length: n }, (_, i) => <div key={i} className="my-1 h-[54px] animate-pulse rounded-xl bg-fg/[0.03]" />)}</>
)

/** 热门项目：默认的"最热门"由首页 loader 取回，切换到其他排序时再在浏览器里请求 */
function HotProjects({ initial }: { initial: ServerItem[] }) {
  const { m, tr, to, locale } = useI18n()
  const [tab, setTab] = useState<RankTab>('popular')
  const [hover, setHover] = useState<string | null>(null)
  const list = useApi(tab === 'popular' ? null : `home:hot:${tab}:${locale}`, (signal) => fetchList('server', { page: 1, pageSize: 6, sort: SORT[tab], locale }, signal), { keepPrevious: true })
  const rows = tab === 'popular' ? initial : (list.data?.data ?? initial)
  return (
    <div>
      <Heading
        title={m.rank.hot}
        sub={m.rank.hotSub}
        right={
          <div className="flex shrink-0 gap-0.5 rounded-lg bg-subtle p-[3px]">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={clsx('relative whitespace-nowrap rounded-md px-3 py-1 text-sm transition-colors', tab === t ? 'font-medium text-ink' : 'text-text2 hover:text-ink')}>
                {tab === t && <motion.span layoutId="hot-seg" className="absolute inset-0 rounded-md bg-fg/10" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
                <span className="relative">{m.rank.tabs[t]}</span>
              </button>
            ))}
          </div>
        }
      />
      <div className="rounded-2xl border border-fg/[0.08] px-2.5 py-1.5" style={panel('#2B7FFF')} onMouseLeave={() => setHover(null)}>
        {rows.length === 0 && list.loading ? <RowSkeleton n={6} /> : (
          <LayoutGroup id="hot">
            {rows.map((r, idx) => {
              const cat = categoryOf('server', r.category?.slug)
              return (
                <MotionLink
                  to={to(`/servers/${r.slug}`)}
                  layout
                  key={r.slug}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  onMouseEnter={() => setHover(r.slug)}
                  className="relative flex items-center gap-4 rounded-xl px-3 py-3"
                >
                  {hover === r.slug && <motion.span layoutId="hot-hl" className="absolute inset-0 rounded-xl bg-fg/[0.05]" transition={spring} />}
                  <span className={clsx('relative w-6 tabular-nums text-sm font-medium', idx < 3 ? 'text-accent' : 'text-text3')}>{String(idx + 1).padStart(2, '0')}</span>
                  <EntityIcon name={r.name} src={r.iconUrl} color={cat.color} size={36} className="relative" />
                  <div className="relative min-w-0 flex-1">
                    <div className="flex items-baseline gap-2"><span className="truncate text-[15px] font-semibold">{r.name}</span><span className="truncate text-xs text-text3">{developerOf(r)}</span></div>
                    <div className="truncate text-[13px] text-text2">{r.tagline}</div>
                  </div>
                  <span className="relative hidden whitespace-nowrap text-xs text-text2 sm:block">{tr(cat.name)}</span>
                  <span className="relative flex w-16 items-center justify-end gap-1 tabular-nums text-sm">{r.stars !== null && <><Star size={13} className="text-text3" /><CountUp value={r.stars} /></>}</span>
                </MotionLink>
              )
            })}
          </LayoutGroup>
        )}
      </div>
      <LinkArrow href="/rankings" className="mt-5">{m.rank.hotMore}</LinkArrow>
    </div>
  )
}

function SkillRanking({ rows }: { rows: SkillItem[] }) {
  const { m, to } = useI18n()
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div>
      <Heading title={m.rank.skill} sub={m.rank.skillSub} />
      <div className="rounded-2xl border border-fg/[0.08] px-2.5 py-1.5" style={panel('#9B6CE0')} onMouseLeave={() => setHover(null)}>
        {rows.map((s, idx) => {
          const cat = categoryOf('skill', s.category?.slug)
          return (
            <Link key={s.slug} to={to(`/skills/${s.slug}`)} onMouseEnter={() => setHover(s.slug)} className="group relative flex items-center gap-3.5 rounded-xl px-3 py-[11px]">
              {hover === s.slug && <motion.span layoutId="skill-hl" className="absolute inset-0 rounded-xl bg-fg/[0.05]" transition={spring} />}
              <span className={clsx('relative w-5 tabular-nums text-sm font-medium', idx < 3 ? 'text-accent' : 'text-text3')}>{String(idx + 1).padStart(2, '0')}</span>
              <span
                className="relative grid size-8 place-items-center rounded-[9px] border transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                style={{ background: cat.color + '29', borderColor: cat.color + '4D', color: cat.color }}
              >
                <cat.icon size={16} />
              </span>
              <div className="relative min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="truncate text-xs text-text3">{repoPath(s.links.repository) ?? developerOf(s)}</div>
              </div>
              {s.installs !== null && <span className="relative flex items-center gap-1 tabular-nums text-sm text-text2"><DownloadSimple size={13} className="text-text3" /><CountUp value={s.installs} /></span>}
            </Link>
          )
        })}
      </div>
      <LinkArrow href="/skills" className="mt-5">{m.rank.skillMore}</LinkArrow>
    </div>
  )
}

export function Rankings({ hot, skills }: { hot: ServerItem[]; skills: SkillItem[] }) {
  return (
    <Container className="pb-24 pt-16">
      <RevealGroup className="grid gap-12 lg:grid-cols-[1fr_420px] lg:gap-14 [&>*]:min-w-0" stagger={0.12}>
        <RevealItem><HotProjects initial={hot} /></RevealItem>
        <RevealItem><SkillRanking rows={skills} /></RevealItem>
      </RevealGroup>
    </Container>
  )
}
