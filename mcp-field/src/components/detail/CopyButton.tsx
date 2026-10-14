import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy } from '@phosphor-icons/react'
import { useState } from 'react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* 剪贴板不可用时仍给出视觉反馈 */
  }
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { m } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        await copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
      className={clsx('flex h-7 items-center gap-1.5 rounded-[7px] border border-fg/10 bg-fg/[0.06] px-2.5 text-xs transition-colors hover:border-fg/25', done ? 'text-accent' : 'text-text2 hover:text-ink', className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
          {done ? <Check size={13} weight="bold" /> : <Copy size={13} />}
        </motion.span>
      </AnimatePresence>
      {done ? m.detail.copied : m.detail.copy}
    </button>
  )
}

/** 头部主按钮：复制安装命令或提示词，复制后图标与文字切换为"已复制" */
export function PrimaryCopyButton({ text, label }: { text: string; label: string }) {
  const { m } = useI18n()
  const [done, setDone] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        copyText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1600)
      }}
      className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(0,0,0,0.12)] transition-[filter] hover:brightness-110"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }}>
          {done ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
        </motion.span>
      </AnimatePresence>
      {done ? m.detail.copied : label}
    </motion.button>
  )
}
