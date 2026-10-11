import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import { CaretDown, Check, Translate } from '@phosphor-icons/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { useI18n, useLocaleSwitch } from '../i18n/context'
import { LOCALE_META, LOCALES } from '../i18n/locales'

export function LanguageMenu({ variant = 'icon' }: { variant?: 'icon' | 'text' }) {
  const { locale, m } = useI18n()
  const switchTo = useLocaleSwitch()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger
        aria-label={m.nav.language}
        className={clsx(
          'outline-none transition-colors',
          variant === 'icon'
            ? 'grid size-[34px] place-items-center rounded-lg text-text2 hover:bg-fg/[0.06] hover:text-ink data-[state=open]:bg-fg/[0.08] data-[state=open]:text-ink'
            : 'flex items-center gap-1.5 text-xs text-text2 hover:text-ink',
        )}
      >
        <Translate size={variant === 'icon' ? 17 : 14} />
        {variant === 'text' && (
          <>
            {LOCALE_META[locale].label}
            <CaretDown size={12} className={clsx('transition-transform', open && 'rotate-180')} />
          </>
        )}
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content asChild align="end" side={variant === 'text' ? 'top' : 'bottom'} sideOffset={8}>
              <motion.div
                initial={{ opacity: 0, y: variant === 'text' ? 6 : -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="z-50 w-[168px] rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                {LOCALES.map((l) => (
                  <DropdownMenu.Item
                    key={l}
                    lang={LOCALE_META[l].htmlLang}
                    onSelect={() => navigate(switchTo(l))}
                    className={clsx('flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-fg/[0.07]', l === locale ? 'text-ink' : 'text-text2')}
                  >
                    <span className="flex-1">{LOCALE_META[l].label}</span>
                    {l === locale && <Check size={14} className="text-accent" />}
                  </DropdownMenu.Item>
                ))}
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  )
}
