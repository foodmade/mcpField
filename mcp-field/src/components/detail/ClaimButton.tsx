import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle, CircleNotch, GithubLogo, SealCheck, WarningCircle, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { ClaimResult, ClaimStatus } from '../../lib/claims'

/**
 * 详情页头部作者后面的认领入口：未认领时是一个不起眼的"认领"文字链接，自己认领过的显示"你已认领"，
 * 别人认领的不显示（头部已有"已认证"标识）。状态在浏览器里读取，读到之前和没有关联 GitHub 仓库时不显示。
 */
export function ClaimButton({ status, busy, onClaim }: { status: ClaimStatus | null; busy: boolean; onClaim: () => void }) {
  const { m } = useI18n()
  const t = m.detail.claim
  if (!status?.claimable) return null
  if (status.claim) {
    if (!status.mine) return null
    return (
      <span title={t.by(status.claim.login)} className="flex items-center gap-1 whitespace-nowrap text-xs text-text3">
        <SealCheck size={13} />
        {t.mine}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClaim}
      disabled={busy}
      title={t.hint}
      className="flex items-center gap-1 whitespace-nowrap text-xs text-text3 transition-colors hover:text-ink disabled:cursor-wait"
    >
      {busy ? <CircleNotch size={13} className="animate-spin" /> : <GithubLogo size={13} />}
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
