import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import { CaretDown, Check, Lightning, Terminal } from '@phosphor-icons/react'
import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { installLinks } from '../../lib/config'
import { copyText } from './CopyButton'

export function InstallMenu({ name, url, transport }: { name: string; url: string; transport?: string }) {
  const { m } = useI18n()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const links = installLinks(name, url, transport)
  const item = 'flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm text-text2 outline-none data-[highlighted]:bg-fg/[0.07] data-[highlighted]:text-ink'
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        <motion.button
          whileTap={{ scale: 0.96 }}
          className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-6px_#3DDC9780] outline-none"
        >
          <Lightning size={15} weight="fill" />
          {m.detail.install}
          <CaretDown size={12} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </motion.button>
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
                className="z-50 w-[244px] rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                <DropdownMenu.Item asChild className={item}>
                  <a href={links.cursor}><span className="grid size-6 place-items-center rounded-md bg-[#F3F4F6] text-xs font-bold text-bg">C</span>{m.detail.installIn('Cursor')}</a>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild className={item}>
                  <a href={links.vscode}><span className="grid size-6 place-items-center rounded-md bg-[#2B7FFF] text-xs font-bold text-white">V</span>{m.detail.installIn('VS Code')}</a>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={item}
                  onSelect={(e) => {
                    e.preventDefault()
                    copyText(links.claudeCode)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1600)
                  }}
                >
                  <span className="grid size-6 place-items-center rounded-md bg-[#D97757] text-white"><Terminal size={13} /></span>
                  <span className="flex-1">{copied ? m.detail.copied : m.detail.copyCli}</span>
                  {copied && <Check size={14} className="text-accent" />}
                </DropdownMenu.Item>
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  )
}
