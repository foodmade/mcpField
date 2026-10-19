import { AnimatePresence, motion } from 'motion/react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Check, CircleNotch, Copy, DotsThree, EnvelopeSimple, LinkBreak, Lightbulb, LockSimple, PaperPlaneTilt, WarningCircle, Wrench, X, type Icon,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/context'
import type { BaseItem, Kind } from '../../lib/api/entities'
import { isEmail, profile, useSession } from '../../lib/auth'
import { FEEDBACK_MAX, FEEDBACK_TYPES, sendFeedback, type FeedbackType } from '../../lib/feedback'
import { EntityIcon } from '../EntityIcon'

const TYPE_ICON: Record<FeedbackType, Icon> = {
  wrong_info: WarningCircle,
  broken_link: LinkBreak,
  install: Wrench,
  duplicate: Copy,
  suggestion: Lightbulb,
  other: DotsThree,
}

/**
 * 详情页头部"反馈"按钮打开的弹窗：选问题类型、写说明，未登录时可以留邮箱；提交成功后换成感谢提示。
 * 关闭时清空，下次打开重新填写。
 */
export function FeedbackDialog({ open, onOpenChange, kind, d, kindLabel, color }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: Kind
  d: BaseItem
  /** 类型名称，例如"MCP 服务" */
  kindLabel: string
  /** 没有图标时的底色 */
  color: string
}) {
  const { m } = useI18n()
  const t = m.detail.feedbackForm
  const { user } = useSession()
  const [type, setType] = useState<FeedbackType>('wrong_info')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setType('wrong_info')
      setBody('')
      setEmail('')
      setState('idle')
      setError(null)
    }
  }

  const emailBad = !user && email.trim() !== '' && !isEmail(email.trim())
  const canSend = body.trim() !== '' && body.length <= FEEDBACK_MAX && !emailBad && state === 'idle'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    setState('sending')
    setError(null)
    try {
      await sendFeedback(kind, d.slug, { type, body: body.trim(), ...(user ? {} : { email: email.trim() }) })
      setState('done')
    } catch (err) {
      setState('idle')
      setError((err as { code?: string }).code === 'rate_limited' ? t.rateLimited : t.failed)
    }
  }

  const field = 'w-full rounded-[10px] border border-fg/[0.08] bg-fg/[0.02] text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-text3 focus:border-accent/50 focus:shadow-[0_0_0_3px] focus:shadow-accent/15'

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className={clsx(
                  'fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-fg/10 bg-surface shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]',
                  state === 'done' ? 'w-[min(440px,calc(100vw-32px))]' : 'w-[min(560px,calc(100vw-32px))]',
                )}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                {state === 'done' ? (
                  <div className="flex flex-col items-center px-8 pb-7 pt-9 text-center">
                    <span className="grid size-[52px] place-items-center rounded-full border border-accent/25 bg-accent/10 text-accent">
                      <Check size={24} weight="bold" />
                    </span>
                    <Dialog.Title className="mt-[18px] text-[17px] font-semibold text-ink">{t.doneTitle}</Dialog.Title>
                    <p className="mt-2 text-sm leading-relaxed text-text2">{t.doneText}</p>
                    <Dialog.Close className="mt-6 h-[38px] w-full rounded-full border border-fg/10 bg-fg/[0.06] text-sm font-medium text-ink transition-colors hover:bg-fg/10">
                      {t.done}
                    </Dialog.Close>
                  </div>
                ) : (
                  <form onSubmit={(e) => void submit(e)}>
                    <div className="flex items-start justify-between gap-4 pl-6 pr-5 pt-5">
                      <div className="min-w-0">
                        <Dialog.Title className="text-[17px] font-semibold text-ink">{t.title}</Dialog.Title>
                        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-sm text-text2">
                          <EntityIcon name={d.name} src={d.iconUrl} color={color} size={18} className="shrink-0" />
                          <span className="truncate">{d.name}</span>
                          <span className="shrink-0 text-text3">· {kindLabel}</span>
                        </p>
                      </div>
                      <Dialog.Close aria-label={t.close} className="grid size-[30px] shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-fg/[0.06] hover:text-ink">
                        <X size={16} />
                      </Dialog.Close>
                    </div>

                    <div className="flex flex-col gap-5 px-6 pb-6 pt-[22px]">
                      <fieldset>
                        <legend className="mb-2.5 text-sm font-medium text-ink">{t.type}</legend>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {FEEDBACK_TYPES.map((value) => {
                            const I = TYPE_ICON[value]
                            const on = value === type
                            return (
                              <label
                                key={value}
                                className={clsx(
                                  'flex h-9 cursor-pointer items-center gap-[7px] rounded-[9px] border px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                                  on ? 'border-accent/40 bg-accent/10 font-medium text-mint' : 'border-fg/[0.08] bg-fg/[0.02] text-text2 hover:border-fg/15 hover:text-ink',
                                )}
                              >
                                <input type="radio" name="feedback-type" value={value} checked={on} onChange={() => setType(value)} className="sr-only" />
                                <I size={15} className={on ? 'text-accent' : 'text-text3'} />
                                <span className="truncate">{t.types[value]}</span>
                              </label>
                            )
                          })}
                        </div>
                      </fieldset>

                      <div>
                        <div className="mb-2.5 flex items-center justify-between">
                          <label htmlFor="feedback-body" className="text-sm font-medium text-ink">{t.body}</label>
                          <span className={clsx('font-mono text-[11px]', body.length > FEEDBACK_MAX ? 'text-rose' : 'text-text3')}>
                            {body.length} / {FEEDBACK_MAX}
                          </span>
                        </div>
                        <textarea
                          id="feedback-body"
                          autoFocus
                          rows={5}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder={t.bodyPlaceholder}
                          className={clsx(field, 'block resize-none px-3.5 py-3 leading-relaxed')}
                        />
                      </div>

                      {!user && (
                        <div>
                          <label htmlFor="feedback-email" className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-ink">
                            {t.email}
                            <span className="text-xs font-normal text-text3">{t.optional}</span>
                          </label>
                          <div className="relative">
                            <EnvelopeSimple size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text3" />
                            <input
                              id="feedback-email"
                              type="email"
                              autoComplete="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder={t.emailPlaceholder}
                              aria-invalid={emailBad || undefined}
                              className={clsx(field, 'h-10 pl-9 pr-3.5', emailBad && '!border-rose/60 focus:!shadow-rose/15')}
                            />
                          </div>
                          {emailBad && <p className="mt-1.5 text-xs text-rose">{t.emailInvalid}</p>}
                        </div>
                      )}

                      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-fg/[0.06] bg-fg/[0.015] px-6 py-3.5">
                      <p className="flex min-w-0 items-center gap-1.5 text-xs text-text3">
                        <LockSimple size={13} className="shrink-0" />
                        <span className="truncate">{user ? t.asUser(profile(user).name) : t.privacy}</span>
                      </p>
                      <div className="ml-auto flex items-center gap-2">
                        <Dialog.Close type="button" className="h-9 rounded-full px-4 text-sm text-text2 transition-colors hover:bg-fg/[0.06] hover:text-ink">
                          {t.cancel}
                        </Dialog.Close>
                        <button
                          type="submit"
                          disabled={!canSend}
                          className="flex h-9 items-center gap-1.5 rounded-full bg-accent px-[18px] text-sm font-semibold text-accent-ink transition-[opacity,transform] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {state === 'sending' ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />}
                          {state === 'sending' ? t.submitting : t.submit}
                        </button>
                      </div>
                    </div>
                  </form>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
