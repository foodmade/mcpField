import { CaretLeft, CaretRight, CircleNotch, WarningCircle } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { STATE_TONE, type RunState, type StageState } from '../lib/labels'

/* 通用小组件：卡片、状态灯、按钮、分页、加载与出错 */

export const TONE_BG = { ok: 'bg-ok', run: 'bg-run', warn: 'bg-warn', err: 'bg-err', idle: 'bg-idle' } as const
export const TONE_TEXT = { ok: 'text-ok', run: 'text-run', warn: 'text-warn', err: 'text-err', idle: 'text-text3' } as const
const TONE_SOFT = { ok: 'bg-ok/10', run: 'bg-run/15', warn: 'bg-warn/15', err: 'bg-err/15', idle: 'bg-white/5' } as const

export const toneOf = (state: StageState | RunState) => STATE_TONE[state].tone

/** 手机上（< md）把表格每一行摊成一张卡片：表头隐藏，单元格依次排开、放不下换行；单元格自己再用 max-md:w-full、max-md:hidden 等控制占位 */
export const STACKED =
  'max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden max-md:[&_tr]:flex max-md:[&_tr]:flex-wrap max-md:[&_tr]:items-center max-md:[&_tr]:gap-x-3 max-md:[&_tr]:gap-y-2 max-md:[&_tr]:px-4 max-md:[&_tr]:py-3 max-md:[&_td]:p-0'

export function Card({ title, sub, right, children, className, padded = true }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-surface', padded && 'p-4 md:p-5', className)}>
      {(title || right) && (
        <header className={clsx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', padded ? 'mb-4' : 'px-4 pb-3 pt-4 md:px-5')}>
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-text3">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

/** 状态灯：失败和进行中加一圈底色，扫一眼就能看到 */
export function Dot({ state, title, size = 9 }: { state: StageState | RunState; title?: string; size?: number }) {
  const tone = toneOf(state)
  const ring = tone === 'err' || tone === 'run'
  return (
    <span title={title ?? STATE_TONE[state].label} className={clsx('inline-flex shrink-0 items-center justify-center rounded-full', ring && TONE_SOFT[tone])} style={{ width: ring ? size * 2 : size, height: ring ? size * 2 : size }}>
      <span className={clsx('rounded-full', TONE_BG[tone], state === 'running' && 'animate-pulse')} style={{ width: size, height: size }} />
    </span>
  )
}

export function Pill({ state, label }: { state: StageState | RunState; label?: string }) {
  const tone = toneOf(state)
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs', TONE_SOFT[tone], TONE_TEXT[tone])}>
      <span className={clsx('size-1.5 rounded-full', TONE_BG[tone], state === 'running' && 'animate-pulse')} />
      {label ?? STATE_TONE[state].label}
    </span>
  )
}

export function Button({ children, onClick, primary, danger, disabled, icon, type = 'button', className }: { children?: ReactNode; onClick?: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; icon?: ReactNode; type?: 'button' | 'submit'; className?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50',
        primary ? 'bg-ink font-semibold text-bg hover:bg-white' : danger ? 'border border-err/40 text-err hover:bg-err/10' : 'border border-line text-text2 hover:bg-white/5 hover:text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-text3">
      <CircleNotch className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-err/30 bg-err/5 px-4 py-3 text-sm text-err md:px-5 md:py-4">
      <span className="flex min-w-0 items-center gap-2 break-words">
        <WarningCircle className="size-4 shrink-0" />
        {error.message}
      </span>
      {retry && <Button onClick={retry}>重试</Button>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center text-sm text-text3">{children}</div>
}

/** 页码：首尾 + 当前页前后各两页（手机上各一页） */
export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages, ...(window.innerWidth >= 768 ? [page - 2, page + 2] : [])])].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md px-2 font-mono text-xs tabular'
  return (
    <div className="flex items-center gap-1">
      <button className={clsx(btn, 'text-text2 hover:bg-white/5 disabled:opacity-30')} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
        <CaretLeft className="size-3.5" />
      </button>
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-1">
          {i > 0 && p - pages[i - 1]! > 1 && <span className="px-1 text-text3">…</span>}
          <button className={clsx(btn, p === page ? 'border border-line bg-white/10 text-ink' : 'text-text2 hover:bg-white/5')} onClick={() => onChange(p)}>
            {p.toLocaleString('en-US')}
          </button>
        </span>
      ))}
      <button className={clsx(btn, 'text-text2 hover:bg-white/5 disabled:opacity-30')} disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="下一页">
        <CaretRight className="size-3.5" />
      </button>
    </div>
  )
}

export function Select<T extends string>({ label, value, options, onChange, highlight }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; highlight?: boolean }) {
  return (
    <label className={clsx('flex h-9 items-center gap-2 rounded-lg border pl-3 pr-1 text-[13px]', highlight ? 'border-err/50 bg-err/5' : 'border-line bg-surface')}>
      <span className="text-xs text-text3">{label}</span>
      <select className={clsx('h-full cursor-pointer bg-transparent pr-1 outline-none', highlight ? 'text-err' : 'text-ink')} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface text-ink">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
