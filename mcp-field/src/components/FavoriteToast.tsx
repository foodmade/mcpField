import { ArrowRight, BookmarkSimple, WarningCircle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { showToast, useToast } from '../lib/favorites'

/** 收藏的轻提示：右下角（窄屏在底部居中），4 秒后消失；详情页和控制台各放一个 */
export function FavoriteToastHost() {
  const toast = useToast()

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => showToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const action = toast?.action
  const actionClass = clsx('flex shrink-0 items-center gap-1 text-sm font-medium transition-opacity hover:opacity-80', toast?.tone === 'added' ? 'text-accent' : 'text-ink')
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-[380px] items-center gap-3 rounded-xl border border-fg/[0.12] bg-subtle/95 px-3.5 py-3 shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:mx-0 sm:w-[380px]"
        >
          <span className={clsx('grid size-[30px] shrink-0 place-items-center rounded-lg', toast.tone === 'added' ? 'bg-gold/15 text-gold' : toast.tone === 'failed' ? 'bg-[#F2555A]/15 text-[#F2555A]' : 'bg-fg/[0.08] text-text2')}>
            {toast.tone === 'failed' ? <WarningCircle size={16} /> : <BookmarkSimple size={16} weight={toast.tone === 'added' ? 'fill' : 'regular'} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{toast.title}</p>
            {toast.desc && <p className="truncate text-xs text-text3">{toast.desc}</p>}
          </div>
          {action?.href ? (
            <Link to={action.href} onClick={() => showToast(null)} className={actionClass}>
              {action.label}
              <ArrowRight size={13} />
            </Link>
          ) : action?.run ? (
            <button
              type="button"
              onClick={() => {
                showToast(null)
                action.run!()
              }}
              className={actionClass}
            >
              {action.label}
            </button>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
