import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import { CaretDown, Check, Clock, Fire, SortAscending, SortDescending } from '@phosphor-icons/react'
import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { SORT_KEYS, type SortKey } from '../../lib/categories'

const ICON = { hot: Fire, new: Clock, name: SortAscending }

export function SortMenu({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  const { m } = useI18n()
  const [open, setOpen] = useState(false)
  const label = m.dir.sorts[value]
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger className="flex h-9 min-w-[148px] items-center gap-2 rounded-[9px] border border-fg/10 bg-fg/[0.04] px-3 text-sm outline-none transition-colors hover:border-fg/20 data-[state=open]:border-fg/30">
        <SortDescending size={15} className="text-text2" />
        <span className="flex-1 whitespace-nowrap text-left">{label}</span>
        <CaretDown size={12} className={`text-text2 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content asChild align="end" sideOffset={6}>
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="z-50 min-w-[188px] origin-top-right rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                {SORT_KEYS.map((key) => {
                  const I = ICON[key]
                  const on = key === value
                  return (
                    <DropdownMenu.Item
                      key={key}
                      onSelect={() => onChange(key)}
                      className={`flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-fg/[0.07] ${on ? 'text-ink' : 'text-text2'}`}
                    >
                      <I size={15} className={on ? 'text-accent' : ''} />
                      <span className="flex-1 whitespace-nowrap">{m.dir.sorts[key]}</span>
                      {on && <Check size={14} className="text-accent" />}
                    </DropdownMenu.Item>
                  )
                })}
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  )
}
