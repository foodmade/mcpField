import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { BookmarkSimple, SignOut, SquaresFour } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import { profile, supabase, useSession } from '../lib/auth'
import { useFavorites } from '../lib/favorites'

const ITEM = 'flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-text2 outline-none data-[highlighted]:bg-fg/[0.07] data-[highlighted]:text-ink'

/**
 * 导航栏右侧：未登录时是「登录」按钮（登录后回到当前页面），已登录时是头像菜单（控制台、我的收藏、退出登录）。
 * 会话在浏览器里读取；读取完成前按钮占位但不显示，避免已登录的人先看到「登录」再变成头像。
 */
export function AccountMenu() {
  const { m, to } = useI18n()
  const { pathname, search } = useLocation()
  const { user, pending } = useSession()
  const favorites = useFavorites()
  const [open, setOpen] = useState(false)

  if (!user) {
    return (
      <Link
        to={`${to('/login')}?redirect=${encodeURIComponent(pathname + search)}`}
        className={clsx('ml-1 flex h-8 items-center whitespace-nowrap rounded-lg bg-ink px-3.5 text-sm font-semibold text-bg transition-transform hover:-translate-y-px active:scale-[0.96]', pending && 'invisible')}
      >
        {m.nav.login}
      </Link>
    )
  }

  const me = profile(user)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger aria-label={m.nav.account} className="ml-1 grid size-8 place-items-center overflow-hidden rounded-full outline-none ring-offset-2 ring-offset-bg transition-shadow hover:ring-2 hover:ring-fg/20 data-[state=open]:ring-2 data-[state=open]:ring-fg/30">
        {me.avatar ? (
          <img src={me.avatar} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center bg-gradient-to-br from-accent to-blue text-sm font-semibold uppercase text-accent-ink">{(me.name || me.email).slice(0, 1)}</span>
        )}
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content asChild align="end" sideOffset={8}>
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="z-50 w-[240px] rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                <div className="px-2.5 pb-2 pt-1.5">
                  <div className="truncate text-sm font-semibold">{me.name}</div>
                  <div className="truncate text-xs text-text3">{me.email}</div>
                </div>
                <DropdownMenu.Separator className="mx-1 mb-1 h-px bg-fg/[0.08]" />
                <DropdownMenu.Item asChild>
                  <Link to={to('/console')} className={ITEM}>
                    <SquaresFour size={16} />
                    {m.nav.console}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild>
                  <Link to={to('/console')} className={ITEM}>
                    <BookmarkSimple size={16} />
                    <span className="flex-1">{m.nav.favorites}</span>
                    {favorites.ready && <span className="font-mono text-xs text-text3">{favorites.keys.size}</span>}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="mx-1 my-1 h-px bg-fg/[0.08]" />
                <DropdownMenu.Item onSelect={() => void supabase().auth.signOut()} className={ITEM}>
                  <SignOut size={16} />
                  {m.nav.logout}
                </DropdownMenu.Item>
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  )
}
