import clsx from 'clsx'
import { translationLabel, type TranslateLocale, type TranslationState } from '../lib/blog'

const TONE = { idle: 'border-line text-text3', run: 'border-run/40 bg-run/10 text-run', ok: 'border-ok/30 bg-ok/10 text-ok', warn: 'border-warn/40 bg-warn/10 text-warn', err: 'border-err/40 bg-err/10 text-err' } as const

/** 列表里的语言小标：EN / JA，颜色表示翻译状态，悬停显示文字 */
export function TranslationBadge({ locale, state }: { locale: TranslateLocale; state: TranslationState | null }) {
  const { label, tone } = translationLabel(state)
  return (
    <span title={`${locale.toUpperCase()}：${label}${state?.error ? `（${state.error}）` : ''}`} className={clsx('inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] font-semibold', TONE[tone], state?.status === 'running' && 'animate-pulse')}>
      {locale.toUpperCase()}
    </span>
  )
}

export function TranslationPill({ state }: { state: TranslationState | null }) {
  const { label, tone } = translationLabel(state)
  return <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]', TONE[tone], state?.status === 'running' && 'animate-pulse')}>{label}</span>
}
