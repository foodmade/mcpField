import { CircleNotch, EnvelopeSimple, GithubLogo, GoogleLogo } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { data, Link, useSearchParams } from 'react-router'
import clsx from 'clsx'
import { LanguageMenu } from '../components/LanguageMenu'
import { Logo } from '../components/Logo'
import { Seo } from '../components/Seo'
import { FieldCanvas } from '../components/login/FieldCanvas'
import { useEnterAnimation } from '../fx/hydration'
import { I18nProvider, useI18n } from '../i18n/context'
import { DEFAULT_LOCALE, localeFromParam } from '../i18n/locales'
import type { Messages } from '../i18n/messages'
import { authConfigured, enabledProviders, failureOf, isEmail, maskEmail, OTP_LENGTH, OTP_MINUTES, safeRedirect, supabase, useSession, type AuthFailure, type SocialProvider } from '../lib/auth'
import type { Route } from './+types/Login'

/*
 * 独立的登录页：不带站点导航和页脚，背景是"光之田"。
 * 三种方式：GitHub、Google、邮箱验证码（先填邮箱，再输入验证码），都由 Supabase Auth 完成。
 * GitHub / Google 授权后回到这个页面（URL 带 ?code=），换到会话后再去 ?redirect= 指定的站内页面。
 * 页面始终是深色，不跟随明暗主题。
 */

export function loader({ params }: Route.LoaderArgs) {
  if (!localeFromParam(params.lang)) throw data(null, { status: 404 })
  return null
}

export default function Login({ params }: Route.ComponentProps) {
  return (
    <I18nProvider locale={localeFromParam(params.lang) ?? DEFAULT_LOCALE}>
      <LoginPage />
    </I18nProvider>
  )
}

type T = Messages['login']
type Step = { kind: 'choose' } | { kind: 'code'; email: string }
/** callback：从 GitHub / Google 授权回来，正在换取会话 */
type Busy = SocialProvider | 'send' | 'verify' | 'email' | 'callback' | null

/** 重新发送验证码前的等待（秒），Supabase 默认 60 秒内只能给同一邮箱发一次 */
const RESEND_AFTER = 60
/** 授权回来后最多等这么久，还没换到会话就提示失败 */
const CALLBACK_TIMEOUT = 10_000
const PROVIDER_NAME: Record<SocialProvider, string> = { github: 'GitHub', google: 'Google' }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const errorText = (t: T, failure: AuthFailure): string => t.errors[failure]

/** 地平线位置：窄屏时登录内容更长，地平线压低一些 */
function useHorizon() {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const mq = matchMedia('(min-width: 640px)')
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide ? 0.62 : 0.72
}

function LoginPage() {
  const { m, locale, to } = useI18n()
  const t = m.login
  const [params] = useSearchParams()
  const redirect = safeRedirect(params.get('redirect'), to('/'))
  const horizon = useHorizon()
  const [step, setStep] = useState<Step>({ kind: 'choose' })
  // 授权回来时带着 ?code=，一进页面就是"接通中"
  const [busy, setBusy] = useState<Busy>(params.get('code') ? 'callback' : null)
  const [hover, setHover] = useState(false)
  const [error, setError] = useState<string | null>(params.get('error') ? t.errors.failed : null)
  const [cooldown, setCooldown] = useState(0)
  const [providers, setProviders] = useState<Record<SocialProvider, boolean> | null>(null)
  const acted = useRef(false)
  const { user } = useSession()
  // 直接打开时内容由服务端以最终状态输出；站内跳转过来才播放淡入
  const enter = useEnterAnimation()

  // 已经登录（或刚从授权页回来换到了会话）就直接去目标页面
  useEffect(() => {
    if (!user || acted.current) return
    const id = setTimeout(() => window.location.replace(redirect), busy === 'callback' ? 500 : 0)
    return () => clearTimeout(id)
  }, [user, redirect, busy])

  useEffect(() => {
    if (busy !== 'callback') return
    const id = setTimeout(() => {
      setBusy(null)
      setError(t.errors.failed)
    }, CALLBACK_TIMEOUT)
    return () => clearTimeout(id)
  }, [busy, t])

  useEffect(() => {
    if (authConfigured) void enabledProviders().then(setProviders)
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const connecting = busy === 'github' || busy === 'google' || busy === 'email' || busy === 'callback'
  const hoverProps = {
    onPointerEnter: () => setHover(true),
    onPointerLeave: () => setHover(false),
    onFocus: () => setHover(true),
    onBlur: () => setHover(false),
  }

  const social = async (provider: SocialProvider) => {
    setError(null)
    if (!authConfigured || providers?.[provider] === false) return setError(t.errors.provider(PROVIDER_NAME[provider]))
    acted.current = true
    setBusy(provider)
    // 先让光沿田垄跑一段，再跳到授权页
    await wait(450)
    const { error } = await supabase().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${to('/login')}?redirect=${encodeURIComponent(redirect)}`,
        // Google 每次都让用户选账号，方便切换
        queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
      },
    })
    if (error) {
      acted.current = false
      setBusy(null)
      setError(errorText(t, failureOf(error)))
    }
  }

  const sendCode = async (email: string) => {
    setError(null)
    if (!authConfigured) return setError(t.errors.failed)
    acted.current = true
    setBusy('send')
    // 首次登录自动建号；locale 存进用户资料，邮件模板可按它切换语言
    const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { locale } } })
    setBusy(null)
    if (error) return setError(errorText(t, failureOf(error)))
    setStep({ kind: 'code', email })
    setCooldown(RESEND_AFTER)
  }

  const verify = async (email: string, otp: string) => {
    setError(null)
    setBusy('verify')
    const { error } = await supabase().auth.verifyOtp({ email, token: otp, type: 'email' })
    if (error) {
      setBusy(null)
      setError(errorText(t, failureOf(error)))
      return false
    }
    setBusy('email')
    await wait(650)
    window.location.assign(redirect)
    return true
  }

  return (
    <div data-theme="dark" className="relative h-svh min-h-[680px] overflow-hidden bg-[#070910] sm:min-h-[760px]">
      <Seo title={t.title} path="/login" noindex />
      <FieldCanvas horizon={horizon} hover={hover} connecting={connecting} className="absolute inset-0 size-full" />
      {/* 近处的田压暗一点，视线集中到地平线 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[140px] bg-gradient-to-b from-transparent to-[#070910]/85" />

      <header className="absolute inset-x-0 top-0 z-10 flex h-[60px] items-center justify-between px-5 sm:h-[76px] sm:px-12">
        <Logo />
        <LanguageMenu variant="text" />
      </header>

      <main className="absolute inset-x-0 bottom-[calc(28%+30px)] z-10 flex justify-center px-6 sm:bottom-[calc(38%+40px)]">
        <motion.div
          initial={enter ? { opacity: 0, y: 10 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[360px]"
        >
          <AnimatePresence mode="wait" initial={false}>
            {step.kind === 'choose' ? (
              <motion.div key="choose" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <h1 className="mb-6 text-center text-[26px] font-semibold tracking-tight sm:mb-7 sm:text-[28px]">{t.welcome}</h1>
                <ChooseStep t={t} busy={busy} error={error} status={busy === 'callback' ? t.completing : null} hoverProps={hoverProps} onSocial={social} onEmail={sendCode} onInvalidEmail={() => setError(t.errors.invalidEmail)} />
              </motion.div>
            ) : (
              <motion.div key="code" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <CodeStep
                  t={t}
                  email={step.email}
                  busy={busy}
                  error={error}
                  cooldown={cooldown}
                  hoverProps={hoverProps}
                  onVerify={(otp) => verify(step.email, otp)}
                  onResend={() => sendCode(step.email)}
                  onBack={() => {
                    setError(null)
                    setStep({ kind: 'choose' })
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  )
}

type HoverProps = { onPointerEnter: () => void; onPointerLeave: () => void; onFocus: () => void; onBlur: () => void }

function ErrorLine({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.p role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="text-center text-[13px] leading-[1.6] text-[#fca5a5]">
          {text}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

function ProviderButton({ provider, primary, busy, label, hoverProps, onClick }: { provider: SocialProvider; primary?: boolean; busy: Busy; label: string; hoverProps: HoverProps; onClick: () => void }) {
  const { m } = useI18n()
  const mine = busy === provider
  const Icon = provider === 'github' ? GithubLogo : GoogleLogo
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null}
      {...hoverProps}
      className={clsx(
        'flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl text-base font-semibold transition-[transform,background-color,box-shadow,opacity] duration-200 enabled:hover:-translate-y-0.5 disabled:cursor-default',
        primary
          ? 'bg-[#F2F4F8] text-[#0A0B0D] shadow-[0_8px_32px_rgba(127,217,255,0.2)] enabled:hover:shadow-[0_10px_40px_rgba(127,217,255,0.4)]'
          : 'border border-white/20 bg-white/[0.06] text-[#F2F4F8] backdrop-blur-md enabled:hover:bg-white/[0.1]',
        busy !== null && !mine && 'opacity-40',
      )}
    >
      {mine ? <CircleNotch size={20} className="animate-spin" /> : <Icon size={20} weight={primary ? 'fill' : 'bold'} />}
      {mine ? m.login.redirecting(PROVIDER_NAME[provider]) : label}
    </button>
  )
}

function ChooseStep({ t, busy, error, status, hoverProps, onSocial, onEmail, onInvalidEmail }: { t: T; busy: Busy; error: string | null; status: string | null; hoverProps: HoverProps; onSocial: (p: SocialProvider) => void; onEmail: (email: string) => void; onInvalidEmail: () => void }) {
  const { to } = useI18n()
  const [email, setEmail] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const value = email.trim()
    if (!isEmail(value)) return onInvalidEmail()
    onEmail(value)
  }
  return (
    <div className="flex flex-col gap-3">
      <ProviderButton provider="github" primary busy={busy} label={t.github} hoverProps={hoverProps} onClick={() => onSocial('github')} />
      <ProviderButton provider="google" busy={busy} label={t.google} hoverProps={hoverProps} onClick={() => onSocial('google')} />
      <div className={clsx('flex items-center gap-3 py-1.5 text-[13px] text-text3 transition-opacity', busy && busy !== 'send' && 'opacity-40')}>
        <span className="h-px flex-1 bg-white/[0.12]" />
        {t.or}
        <span className="h-px flex-1 bg-white/[0.12]" />
      </div>
      <form
        onSubmit={submit}
        noValidate
        className={clsx(
          'flex h-[52px] items-center gap-2.5 rounded-xl border border-white/[0.18] bg-[#0A0D16]/70 pl-4 pr-1.5 backdrop-blur-md transition-[border-color,opacity] focus-within:border-accent/60',
          busy && busy !== 'send' && 'opacity-40',
        )}
      >
        <EnvelopeSimple size={18} className="shrink-0 text-text3" />
        <input
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          aria-label={t.emailLabel}
          placeholder={t.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy !== null}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-text3"
        />
        <button type="submit" disabled={busy !== null} {...hoverProps} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.09] px-3.5 text-sm font-semibold transition-colors enabled:hover:bg-white/[0.15] disabled:cursor-default">
          {busy === 'send' && <CircleNotch size={14} className="animate-spin" />}
          {busy === 'send' ? t.sending : t.sendCode}
        </button>
      </form>
      {status && (
        <p role="status" className="flex items-center justify-center gap-2 text-[13px] text-text2">
          <CircleNotch size={14} className="animate-spin" />
          {status}
        </p>
      )}
      <ErrorLine text={error} />
      <p className="text-balance pt-1 text-center text-[13px] leading-[1.6] text-text3">
        {t.firstLogin}
        <br />
        {t.agree[0]}
        <Link to={to('/privacy')} className="underline decoration-white/30 underline-offset-4 transition-colors hover:text-ink">
          {t.agree[1]}
        </Link>
        {t.agree[2]}
      </p>
    </div>
  )
}

function CodeStep({ t, email, busy, error, cooldown, hoverProps, onVerify, onResend, onBack }: { t: T; email: string; busy: Busy; error: string | null; cooldown: number; hoverProps: HoverProps; onVerify: (otp: string) => Promise<boolean>; onResend: () => void; onBack: () => void }) {
  const [code, setCode] = useState('')
  const [focused, setFocused] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const working = busy !== null

  const submit = async (value: string) => {
    if (value.length !== OTP_LENGTH || working) return
    const ok = await onVerify(value)
    if (!ok) {
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-balance text-center text-[15px] leading-[1.6] text-text2">{t.codeSent(maskEmail(email), OTP_MINUTES)}</p>
      <label className="relative grid grid-cols-6 gap-2.5">
        <span className="sr-only">{t.codeLabel}</span>
        {Array.from({ length: OTP_LENGTH }, (_, i) => {
          const digit = code[i]
          const active = focused && !working && i === Math.min(code.length, OTP_LENGTH - 1)
          return (
            <span
              key={i}
              aria-hidden
              className={clsx(
                'grid h-[60px] place-items-center rounded-[10px] border bg-[#0A0D16]/70 font-mono text-[26px] font-semibold backdrop-blur-md transition-colors',
                active ? 'border-2 border-accent shadow-[0_0_18px_rgba(61,220,151,0.25)]' : digit ? 'border-white/25' : 'border-white/[0.14]',
              )}
            >
              {digit ?? (active && <span className="h-[26px] w-0.5 animate-pulse bg-accent" />)}
            </span>
          )
        })}
        <input
          ref={inputRef}
          autoFocus
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          disabled={working}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH)
            setCode(value)
            if (value.length === OTP_LENGTH) void submit(value)
          }}
          className="absolute inset-0 size-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
        />
      </label>
      <button
        type="button"
        disabled={code.length !== OTP_LENGTH || working}
        onClick={() => void submit(code)}
        {...hoverProps}
        className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#F2F4F8] text-base font-semibold text-[#0A0B0D] transition-[transform,opacity] duration-200 enabled:hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-45"
      >
        {busy === 'verify' && <CircleNotch size={18} className="animate-spin" />}
        {busy === 'verify' || busy === 'email' ? t.verifying : t.verify}
      </button>
      <ErrorLine text={error} />
      <div className="flex items-center justify-between px-0.5 text-[13px]">
        {cooldown > 0 ? (
          <span className="text-text3">{t.resendIn(cooldown)}</span>
        ) : (
          <LinkButton onClick={onResend} disabled={working}>
            {t.resend}
          </LinkButton>
        )}
        <LinkButton onClick={onBack} disabled={working}>
          {t.otherEmail}
        </LinkButton>
      </div>
    </div>
  )
}

function LinkButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="font-semibold text-text2 underline decoration-white/30 underline-offset-4 transition-colors hover:text-ink disabled:opacity-40">
      {children}
    </button>
  )
}
