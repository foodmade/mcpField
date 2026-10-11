import { motion } from 'motion/react'
import { CaretRight } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { Facets } from '../lib/api/entities'
import { categoryOf } from '../lib/categories'
import { Container, SectionHeader } from './ui'

const MotionLink = motion.create(Link)

/** 首页展示的服务分类及底色 */
const HOME_CATEGORIES = [
  { slug: 'dev-tools', bg: '#22324F' },
  { slug: 'ai-agents', bg: '#2A2D36' },
  { slug: 'cloud', bg: '#0E3340' },
  { slug: 'memory', bg: '#123524' },
  { slug: 'media', bg: '#3A2A1C' },
  { slug: 'database', bg: '#1E2A3F' },
  { slug: 'browser', bg: '#16353A' },
  { slug: 'search', bg: '#2E2240' },
  { slug: 'communication', bg: '#3A1F2A' },
  { slug: 'finance', bg: '#2F3218' },
]

export function Categories({ facets }: { facets: Facets }) {
  const { m, tr, to } = useI18n()
  const count = (slug: string) => facets.categories.find((c) => c.slug === slug)?.count
  return (
    <Container className="pt-16">
      <SectionHeader title={m.categories.title} link={m.categories.all} href="/servers" />
      <RevealGroup className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5" stagger={0.04}>
        {HOME_CATEGORIES.map(({ slug, bg }) => {
          const c = categoryOf('server', slug)
          return (
            <RevealItem key={slug}>
              <MotionLink
                to={to(`/servers?category=${slug}`)}
                initial="rest"
                whileHover="hover"
                animate="rest"
                className="relative flex h-16 items-center gap-2.5 overflow-hidden rounded-xl border border-white/[0.06] px-3 sm:gap-3 sm:px-4"
                style={{ background: `linear-gradient(200deg, ${bg}, #121418)` }}
              >
                <motion.div aria-hidden className="absolute inset-0" variants={{ rest: { opacity: 0 }, hover: { opacity: 1 } }} style={{ background: `radial-gradient(120% 140% at 0% 50%, ${c.color}33, transparent 60%)` }} />
                <motion.div
                  variants={{ rest: { rotate: 0, scale: 1 }, hover: { rotate: -12, scale: 1.12 } }}
                  transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                  className="relative grid size-[34px] shrink-0 place-items-center rounded-full text-white"
                  style={{ background: c.color, boxShadow: `0 6px 18px ${c.color}66` }}
                >
                  <c.icon size={16} weight="bold" />
                </motion.div>
                <div className="relative min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold" title={tr(c.name)}>{tr(c.name)}</div>
                  <div className="truncate text-xs text-text2">{count(slug) === undefined ? '\u00a0' : m.categories.count(count(slug)!.toLocaleString('en-US'))}</div>
                </div>
                <motion.span className="relative hidden text-text3 sm:block" variants={{ rest: { x: 0, opacity: 0.6 }, hover: { x: 4, opacity: 1 } }}>
                  <CaretRight size={14} />
                </motion.span>
              </MotionLink>
            </RevealItem>
          )
        })}
      </RevealGroup>
    </Container>
  )
}
