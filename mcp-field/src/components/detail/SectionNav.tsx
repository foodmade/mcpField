import { motion } from 'motion/react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'

export type SectionId = 'overview' | 'config' | 'tools' | 'readme' | 'comments'

export function SectionNav({ active, toolCount, commentCount, onJump }: { active: SectionId; toolCount: number; commentCount: number; onJump: (id: SectionId) => void }) {
  const { m } = useI18n()
  const ids: SectionId[] = ['overview', 'config', 'tools', 'readme', 'comments']
  return (
    <div className="sticky z-30 border-b border-line bg-bg/80 backdrop-blur-xl" style={{ top: 'var(--nav-h, 110px)' }}>
      <nav aria-label={m.detail.sectionNav} className="mx-auto flex max-w-[1248px] gap-7 overflow-x-auto px-6 [scrollbar-width:none]">
        {ids.map((id) => (
          <button
            key={id}
            onClick={() => onJump(id)}
            aria-current={active === id ? 'true' : undefined}
            className={clsx('relative flex shrink-0 items-center gap-1.5 py-3 text-sm transition-colors', active === id ? 'font-semibold text-ink' : 'text-text2 hover:text-ink')}
          >
            {id === 'comments' ? m.comments.title : m.detail.sections[id]}
            {id === 'comments' && commentCount > 0 && <span className="rounded-full bg-white/10 px-1.5 tabular-nums text-xs text-text2">{commentCount}</span>}
            {id === 'tools' && toolCount > 0 && <span className="rounded-full bg-white/10 px-1.5 tabular-nums text-xs text-text2">{toolCount}</span>}
            {active === id && <motion.span layoutId="detail-tab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        ))}
      </nav>
    </div>
  )
}
