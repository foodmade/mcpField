import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle, CircleNotch, GithubLogo, SealCheck, WarningCircle, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { ClaimResult, ClaimStatus } from '../../lib/claims'

/**
 * 详情页头部的认领入口：未认领时是"认领"按钮，已认领时显示认领状态。
 * 状态在浏览器里读取，读到之前和没有关联 GitHub 仓库时不显示。
 */
export function ClaimButton({ status, busy, onClaim }: { status: ClaimStatus | null; busy: boolean; onClaim: () => void }) {
  const { m } = useI18n()
  const t = m.detail.claim
  if (!status?.claimable) return null
  if (status.claim) {
    return (
      <span
        title={t.by(status.claim.login)}
        className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-fg/[0.12] px-3 text-sm text-text2"
      >
        {status.claim.avatar ? <img src={status.claim.avatar} alt="" className="size-[18px] rounded-full" /> : <SealCheck size={15} className="text-accent" />}
        {status.mine ? t.mine : t.claimed}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClaim}
      disabled={busy}
      title={t.hint}
      className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-fg/[0.12] bg-fg/[0.04] px-3 text-sm transition-[color,background-color,border-color,transform] hover:border-fg/25 hover:bg-fg/[0.07] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
    >
      {busy ? <CircleNotch size={15} className="animate-spin text-text2" /> : <GithubLogo size={15} className="text-text2" />}
      {busy ? t.redirecting : t.button}
    </button>
  )
}

/** 认领结果提示：GitHub 跳回详情页后在底部显示 */
export function ClaimNotice({ result, onDismiss }: { result: ClaimResult | null; onDismiss: () => void }) {
  const { m } = useI18n()
  const t = m.detail.claim
  const ok = result === 'ok'
  return (
    <AnimatePresence>
      {result && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-[520px] items-start gap-3 rounded-xl border border-fg/[0.12] bg-subtle/95 px-4 py-3 text-sm shadow-[0_20px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          {ok ? <CheckCircle size={18} weight="fill" className="mt-px shrink-0 text-accent" /> : <WarningCircle size={18} className="mt-px shrink-0 text-gold" />}
          <p className={clsx('flex-1 leading-relaxed', ok ? 'text-ink' : 'text-text2')}>{t.result[result]}</p>
          <button type="button" onClick={onDismiss} aria-label={t.dismiss} className="grid size-6 shrink-0 place-items-center rounded-md text-text2 hover:bg-fg/10 hover:text-ink">
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
