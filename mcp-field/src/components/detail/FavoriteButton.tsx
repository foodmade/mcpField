import { BookmarkSimple } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { Kind } from '../../lib/api/entities'
import { favoriteKey, setFavorite, showToast, useFavorites } from '../../lib/favorites'
import { FavoriteToastHost } from '../FavoriteToast'

/** 登录后回到详情页、自动完成收藏的标记 */
const RESUME = 'favorite'

type Texts = ReturnType<typeof useI18n>['m']['detail']['favorite']

/** 收藏或取消，结果用轻提示告诉用户：收藏成功可去控制台查看，取消可撤销，失败可重试 */
async function toggleFavorite(o: { kind: Kind; slug: string; name: string; on: boolean; t: Texts; viewHref: string }): Promise<void> {
  const { t } = o
  try {
    await setFavorite(o.kind, o.slug, o.on)
    showToast(
      o.on
        ? { tone: 'added', title: t.added, desc: t.addedHint, action: { label: t.view, href: o.viewHref } }
        : { tone: 'removed', title: t.removed, desc: t.removedHint(o.name), action: { label: t.undo, run: () => void toggleFavorite({ ...o, on: true }) } },
    )
  } catch {
    showToast({ tone: 'failed', title: t.failed, desc: t.failedHint, action: { label: t.retry, run: () => void toggleFavorite(o) } })
  }
}

/**
 * 详情页侧栏的「收藏」按钮（与「分享」并排）：
 * 已登录时直接收藏或取消，先改界面，失败时恢复并提示重试；未登录时弹出登录提示，登录回来（带 ?favorite=1）自动完成这次收藏。
 * 收藏状态在浏览器里读取，读到之前按未收藏显示。
 */
export function FavoriteButton({ kind, slug, name, className }: { kind: Kind; slug: string; name: string; className: string }) {
  const { m, to } = useI18n()
  const t = m.detail.favorite
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, pending, ready, keys } = useFavorites()
  const saved = keys.has(favoriteKey(kind, slug))
  const [ask, setAsk] = useState(false)
  const [resume, setResume] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const toggle = useCallback((on: boolean) => toggleFavorite({ kind, slug, name, on, t, viewHref: to('/console') }), [kind, slug, name, t, to])

  // 读一次地址里的继续标记，然后从地址里去掉（不触发路由的数据重新加载）
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get(RESUME) !== '1') return
    url.searchParams.delete(RESUME)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    setResume(true)
  }, [slug])

  // 登录后回来：收藏读到了就自动收藏
  useEffect(() => {
    if (!resume || pending || (user && !ready)) return
    setResume(false)
    if (user && !saved) void toggle(true)
  }, [resume, pending, user, ready, saved, toggle])

  // 点外面或按 Esc 关掉登录提示
  useEffect(() => {
    if (!ask) return
    const onDown = (e: PointerEvent) => box.current?.contains(e.target as Node) || setAsk(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAsk(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ask])

  const onClick = () => {
    if (pending) return
    if (!user) setAsk((v) => !v)
    else if (ready) void toggle(!saved)
  }

  return (
    <div ref={box} className="relative flex flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-expanded={user ? undefined : ask}
        className={clsx(className, 'w-full', saved ? 'border-[#F2C94C]/40 text-gold' : 'border-fg/10 text-text2 hover:text-ink', user && !ready && 'cursor-wait')}
      >
        <BookmarkSimple size={14} weight={saved ? 'fill' : 'regular'} />
        {saved ? m.detail.bookmarked : m.detail.bookmark}
      </button>
      <AnimatePresence>
        {ask && (
          <motion.div
            role="dialog"
            aria-label={t.loginTitle}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="absolute right-0 top-full z-40 mt-2 w-[280px] origin-top-right rounded-xl border border-fg/[0.12] bg-subtle/95 p-4 shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BookmarkSimple size={16} className="text-gold" />
              {t.loginTitle}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-text2">{t.loginHint}</p>
            <div className="mt-3.5 flex justify-end gap-2">
              <button type="button" onClick={() => setAsk(false)} className="h-8 rounded-lg px-3 text-sm text-text2 transition-colors hover:text-ink">
                {t.later}
              </button>
              <button
                type="button"
                onClick={() => navigate(`${to('/login')}?redirect=${encodeURIComponent(`${pathname}?${RESUME}=1`)}`)}
                className="h-8 rounded-lg bg-ink px-3.5 text-sm font-semibold text-bg transition-transform active:scale-[0.97]"
              >
                {t.login}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <FavoriteToastHost />
    </div>
  )
}
