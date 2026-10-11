import { motion } from 'motion/react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Link, type To } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'

function pages(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, total, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= total))
  if (cur <= 3) [2, 3, 4].forEach((p) => set.add(p))
  if (cur >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => set.add(p))
  const sorted = [...set].sort((a, b) => a - b)
  return sorted.flatMap((p, i) => (i > 0 && p - sorted[i - 1] > 1 ? ['…' as const, p] : [p]))
}

const btn = 'flex h-[34px] items-center justify-center gap-1 rounded-[9px] border border-fg/10 text-sm transition-colors'

/** 分页用真实链接（?page=N），爬虫可以逐页抓取；onNavigate 用于翻页后滚回列表顶部 */
export function Pagination({ page, total, to, onNavigate }: { page: number; total: number; to: (p: number) => To; onNavigate?: () => void }) {
  const { m } = useI18n()
  if (total <= 1) return null
  const edge = (p: number, disabled: boolean, label: string, children: ReactNode) =>
    disabled ? (
      <span aria-disabled className={clsx(btn, 'px-3 text-text2 opacity-35')}>{children}</span>
    ) : (
      <Link to={to(p)} preventScrollReset onClick={onNavigate} aria-label={label} rel={p < page ? 'prev' : 'next'} className={clsx(btn, 'px-3 text-text2 hover:border-fg/25 hover:text-ink')}>{children}</Link>
    )
  return (
    <nav aria-label={m.dir.pageNav} className="flex items-center gap-1.5">
      {edge(page - 1, page === 1, m.dir.prev, <><CaretLeft size={13} /><span className="hidden sm:inline">{m.dir.prev}</span></>)}
      {/* 手机上只显示"当前页 / 总页数"，避免页码一多就撑出屏幕 */}
      <span className="px-2 tabular-nums text-sm text-text2 sm:hidden" aria-current="page">{page} / {total}</span>
      <div className="hidden items-center gap-1.5 sm:flex">
        {pages(page, total).map((p, i) =>
          p === '…' ? (
            <span key={`e${i}`} className="px-1 text-text3">…</span>
          ) : (
            <Link key={p} to={to(p)} preventScrollReset onClick={onNavigate} aria-current={p === page ? 'page' : undefined} className={clsx(btn, 'relative w-[34px] tabular-nums', p === page ? 'border-transparent font-semibold text-accent-ink' : 'text-text2 hover:border-fg/25 hover:text-ink')}>
              {p === page && <motion.span layoutId="page-pill" className="absolute inset-0 rounded-[9px] bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
              <span className="relative">{p}</span>
            </Link>
          ),
        )}
      </div>
      {edge(page + 1, page === total, m.dir.next, <><span className="hidden sm:inline">{m.dir.next}</span><CaretRight size={13} /></>)}
    </nav>
  )
}
