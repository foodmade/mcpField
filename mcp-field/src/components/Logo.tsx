import { PlugsConnected } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'

/** 站点标志：渐变方块 + 站名，链接到首页 */
export function Logo({ className }: { className?: string }) {
  const { to } = useI18n()
  return (
    <Link to={to('/')} className={clsx('flex shrink-0 items-center gap-2.5', className)}>
      <motion.span whileHover={{ rotate: -12, scale: 1.06 }} className="grid size-[30px] place-items-center rounded-lg bg-gradient-to-br from-accent to-blue text-accent-ink">
        <PlugsConnected size={18} weight="bold" />
      </motion.span>
      <span className="text-lg font-semibold tracking-tight">MCP Field</span>
    </Link>
  )
}
