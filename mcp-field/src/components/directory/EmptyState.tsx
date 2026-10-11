import { motion } from 'motion/react'
import { FunnelSimple, MagnifyingGlass, SquaresFour } from '@phosphor-icons/react'
import { useEnterAnimation } from '../../fx/hydration'
import { useI18n } from '../../i18n/context'

type EmptyText = { searchTitle: (q: string) => string; searchHint: string; catTitle: string; catHint: (c: string) => string; viewAll: string }

export function EmptyState({ kind, label, onPrimary, text: e }: { kind: 'search' | 'category'; label: string; onPrimary: () => void; text: EmptyText }) {
  const { m } = useI18n()
  const enter = useEnterAnimation()
  const Icon = kind === 'search' ? MagnifyingGlass : FunnelSimple
  return (
    <motion.div
      initial={enter ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      className="flex min-h-[380px] flex-col items-center justify-center gap-3.5 rounded-2xl border border-white/[0.08] px-6 text-center"
      style={{ background: 'radial-gradient(80% 90% at 50% 30%, #2B7FFF1F, transparent 60%), var(--color-surface)' }}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="grid size-16 place-items-center rounded-[18px] border border-white/[0.12] bg-white/[0.04] text-text2"
      >
        <Icon size={28} />
      </motion.div>
      <h3 className="text-lg font-semibold">{kind === 'search' ? e.searchTitle(label) : e.catTitle}</h3>
      <p className="max-w-[420px] text-sm text-text2">
        {kind === 'search' ? e.searchHint : e.catHint(label)}
      </p>
      <div className="flex flex-wrap justify-center gap-2.5 pt-2">
        <button onClick={onPrimary} className="flex h-[38px] items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition-transform active:scale-95">
          <SquaresFour size={14} />{kind === 'search' ? m.dir.clearSearch : e.viewAll}
        </button>
      </div>
    </motion.div>
  )
}
