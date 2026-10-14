import type { Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

/** 区块内的空状态：左侧图标，右侧标题与说明，可带一个操作；不用虚线框和居中排版 */
export function EmptyState({ icon: I, title, hint, action }: { icon: Icon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] border border-fg/[0.08] bg-fg/[0.02] px-5 py-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-fg/[0.08] bg-surface text-text3"><I size={18} /></span>
      <div className="min-w-0 flex-1 basis-[240px]">
        <div className="text-sm font-medium text-ink">{title}</div>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-text3">{hint}</p>}
      </div>
      {action}
    </div>
  )
}
