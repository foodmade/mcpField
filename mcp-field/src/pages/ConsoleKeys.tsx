import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Check, CheckCircle, CircleNotch, Copy, DownloadSimple, Info, Key, MagnifyingGlass, PencilSimple, PlugsConnected, Plus, ShieldCheck, TerminalWindow, Warning, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { data } from 'react-router'
import clsx from 'clsx'
import { ConsoleShell } from '../components/console/ConsoleShell'
import { copyText } from '../components/detail/CopyButton'
import { Seo } from '../components/Seo'
import { I18nProvider, useI18n } from '../i18n/context'
import { DEFAULT_LOCALE, localeFromParam } from '../i18n/locales'
import type { Messages } from '../i18n/messages'
import {
  CONNECT_CLIENTS,
  CONNECT_LABELS,
  connectConfig,
  createKey,
  EXPIRY_OPTIONS,
  KEYS_MAX,
  NAME_MAX,
  removeKey,
  renameKey,
  useApiKeys,
  type ApiKey,
  type ConnectClient,
  type Expiry,
} from '../lib/apiKeys'
import type { Route } from './+types/ConsoleKeys'

/*
 * 控制台「API 密钥」（/console/keys）：创建、重命名、撤销给 MCP 服务（npm 包 mcpfield-mcp）用的密钥，
 * 下面给出各 Agent 的接入命令。完整密钥只在创建成功的弹窗里显示一次，并附带已经填好密钥的配置。
 */

export function loader({ params }: Route.LoaderArgs) {
  if (!localeFromParam(params.lang)) throw data(null, { status: 404 })
  return null
}

export default function ConsoleKeys({ params }: Route.ComponentProps) {
  return (
    <I18nProvider locale={localeFromParam(params.lang) ?? DEFAULT_LOCALE}>
      <KeysPage />
    </I18nProvider>
  )
}

type T = Messages['console']['keys']

/** MCP 握手时 Agent 报上来的名称换成常见的产品名 */
function clientLabel(raw: string): string {
  const v = raw.toLowerCase()
  if (v.includes('claude-ai') || v.includes('desktop')) return 'Claude Desktop'
  if (v.includes('claude')) return 'Claude Code'
  if (v.includes('codex')) return 'Codex'
  if (v.includes('gemini')) return 'Gemini CLI'
  if (v.includes('cursor')) return 'Cursor'
  if (v.includes('windsurf')) return 'Windsurf'
  if (v.includes('vscode') || v.includes('visual studio code')) return 'VS Code'
  return raw
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** 今年的只写月-日 */
const shortDate = (d: Date, now: Date) => (d.getFullYear() === now.getFullYear() ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ymd(d))

function KeysPage() {
  const { m } = useI18n()
  const t = m.console.keys
  const { list, failed, reload } = useApiKeys()
  const [now] = useState(Date.now)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ApiKey | null>(null)

  const active = list?.filter((k) => !k.expired).length ?? 0
  const createButton = (
    <button
      type="button"
      onClick={() => setCreating(true)}
      disabled={!list}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_6px_18px_rgba(61,220,151,0.2)] transition-[filter,transform] hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
    >
      <Plus size={15} weight="bold" />
      {t.create}
    </button>
  )

  return (
    <ConsoleShell section="keys" title={t.heading} sub={t.sub} action={createButton}>
      <Seo title={t.title} path="/console/keys" noindex />
      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-24 text-center">
          <p className="text-sm text-text2">{t.error}</p>
          <button type="button" onClick={reload} className="h-9 rounded-full border border-fg/[0.12] px-4 text-sm hover:border-fg/25">
            {t.retry}
          </button>
        </div>
      ) : (
        <>
          {list && list.length === 0 ? (
            <EmptyKeys t={t} onCreate={() => setCreating(true)} />
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-fg/[0.08] bg-surface">
                <div className="hidden h-10 items-center border-b border-fg/[0.08] bg-fg/[0.02] px-5 text-xs text-text3 md:flex">
                  <span className="flex-1">{t.cols.name}</span>
                  <span className="w-[180px]">{t.cols.key}</span>
                  <span className="hidden w-[190px] lg:block">{t.cols.used}</span>
                  <span className="w-[130px]">{t.cols.expires}</span>
                  <span className="w-[120px] text-right">{t.cols.actions}</span>
                </div>
                {list
                  ? list.map((k) => <KeyRow key={k.id} k={k} t={t} now={now} onRevoke={() => setConfirm(k)} />)
                  : Array.from({ length: 3 }, (_, i) => (
                      <div key={i} className="flex h-16 items-center gap-3 border-b border-fg/[0.06] px-5 last:border-0">
                        <div className="size-[34px] animate-pulse rounded-[9px] bg-fg/[0.06]" />
                        <div className="h-3.5 w-40 animate-pulse rounded bg-fg/[0.06]" />
                      </div>
                    ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-1 text-sm text-text3">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={14} className="shrink-0" />
                  {t.note}
                </span>
                {list && <span>{t.count(active, KEYS_MAX)}</span>}
              </div>
            </>
          )}
          <ConnectPanel t={t} />
        </>
      )}
      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        t={t}
        onCreated={(key) => {
          setCreating(false)
          setCreated(key)
        }}
      />
      <DoneDialog apiKey={created} onClose={() => setCreated(null)} t={t} />
      <RevokeDialog target={confirm} onClose={() => setConfirm(null)} t={t} />
    </ConsoleShell>
  )
}

function KeyRow({ k, t, now: nowMs, onRevoke }: { k: ApiKey; t: T; now: number; onRevoke: () => void }) {
  const { m } = useI18n()
  const now = new Date(nowMs)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(k.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const save = async () => {
    const value = name.trim()
    if (!value || value === k.name) {
      setEditing(false)
      setName(k.name)
      return
    }
    setSaving(true)
    try {
      await renameKey(k.id, value)
      setEditing(false)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  const days = k.expiresAt ? Math.ceil((new Date(k.expiresAt).getTime() - nowMs) / 86_400_000) : null
  const used = k.lastUsedAt ? new Date(k.lastUsedAt) : null
  const usedText = used ? relative(used, now, m.console) : t.never
  return (
    <div className={clsx('group flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 border-b border-fg/[0.06] px-4 py-3 transition-colors last:border-0 hover:bg-fg/[0.025] sm:px-5 md:flex-nowrap md:gap-0')}>
      <div className={clsx('flex min-w-0 flex-1 items-center gap-3', k.expired && 'opacity-55')}>
        <span className={clsx('grid size-[34px] shrink-0 place-items-center rounded-[9px] border', k.expired ? 'border-fg/10 bg-fg/[0.04] text-text3' : 'border-accent/20 bg-accent/[0.08] text-accent')}>
          <Key size={16} />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
              className="flex items-center gap-1.5"
            >
              <input
                ref={input}
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditing(false)
                    setName(k.name)
                  }
                }}
                aria-label={t.rename}
                className="h-8 w-full max-w-[280px] rounded-lg border border-accent/60 bg-fg/[0.04] px-2.5 text-sm outline-none"
              />
              <button type="submit" disabled={saving} className="h-8 shrink-0 rounded-lg bg-ink px-3 text-xs font-semibold text-bg disabled:opacity-60">
                {saving ? <CircleNotch size={13} className="animate-spin" /> : t.save}
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold">{k.name}</span>
              {k.expired && <span className="shrink-0 rounded-full border border-[#F2555A]/30 bg-[#F2555A]/10 px-1.5 text-[11px] text-[#F2555A]">{t.expired}</span>}
            </div>
          )}
          <p className={clsx('truncate text-xs', error ? 'text-[#F2555A]' : 'text-text3')}>
            {error ? t.renameFailed : t.createdOn(shortDate(new Date(k.createdAt), now))}
            <span className="font-mono md:hidden"> · {k.hint}</span>
          </p>
        </div>
      </div>
      <div className={clsx('hidden w-[180px] md:block', k.expired && 'opacity-55')}>
        <span className="rounded-md border border-fg/[0.07] bg-fg/[0.03] px-2 py-0.5 font-mono text-xs text-text2">{k.hint}</span>
      </div>
      <div className={clsx('hidden w-[190px] lg:block', k.expired && 'opacity-55')}>
        <p className={clsx('text-[13px]', used ? 'text-text2' : 'text-text3')}>{usedText}</p>
        {k.lastUsedClient && <p className="truncate text-[11px] text-text3">{t.via(clientLabel(k.lastUsedClient))}</p>}
      </div>
      <div className="w-[130px] max-md:order-last max-md:w-auto max-md:pl-[46px]">
        {k.expiresAt ? (
          <>
            <p className={clsx('font-mono text-xs', k.expired ? 'text-[#F2555A]' : 'text-text2')}>{ymd(new Date(k.expiresAt))}</p>
            {!k.expired && days !== null && days <= 7 && <p className="text-[11px] text-gold">{t.expiresIn(days)}</p>}
          </>
        ) : (
          <p className="text-xs text-text2">{t.forever}</p>
        )}
      </div>
      <div className="ml-auto flex w-[120px] shrink-0 items-center justify-end gap-1 md:ml-0">
        {!k.expired && !editing && (
          <button
            type="button"
            title={t.rename}
            aria-label={t.rename}
            onClick={() => setEditing(true)}
            className="grid size-[30px] place-items-center rounded-lg text-text3 transition-colors hover:bg-fg/[0.07] hover:text-ink"
          >
            <PencilSimple size={15} />
          </button>
        )}
        {editing ? (
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setName(k.name)
            }}
            className="h-[30px] rounded-lg px-2.5 text-xs text-text2 hover:text-ink"
          >
            {t.cancel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRevoke}
            className="h-[30px] rounded-lg border border-fg/[0.1] px-2.5 text-xs text-text2 transition-colors hover:border-[#F2555A]/40 hover:bg-[#F2555A]/10 hover:text-[#F2555A]"
          >
            {k.expired ? t.remove : t.revoke}
          </button>
        )}
      </div>
    </div>
  )
}

/** 最近使用：今天显示时分，昨天、一周内显示相对时间，更早显示日期 */
function relative(at: Date, now: Date, c: Messages['console']): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days <= 0) return `${c.today} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (days === 1) return c.yesterday
  if (days < 7) return c.daysAgo(days)
  return shortDate(at, now)
}

function EmptyKeys({ t, onCreate }: { t: T; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-fg/[0.08] bg-surface px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-2xl border border-accent/25 bg-accent/[0.08] text-accent shadow-[0_10px_28px_rgba(61,220,151,0.12)]">
        <Key size={26} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">{t.empty.title}</h2>
      <p className="mt-2 max-w-[520px] text-balance text-sm leading-relaxed text-text2">{t.empty.hint}</p>
      <ol className="mt-4 flex flex-wrap items-center justify-center gap-2.5 text-sm text-text2">
        {t.empty.steps.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && <ArrowRight size={13} className="text-text3" aria-hidden />}
            <li className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-fg/[0.07] font-mono text-[11px]">{i + 1}</span>
              {s}
            </li>
          </Fragment>
        ))}
      </ol>
      <button type="button" onClick={onCreate} className="mt-5 flex h-[38px] items-center gap-1.5 rounded-full bg-accent px-[18px] text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-110">
        <Plus size={15} weight="bold" />
        {t.empty.create}
      </button>
    </div>
  )
}

/** 客户端切换 + 代码块；apiKey 为空时用占位文字 */
function ConnectCode({ t, apiKey, compact }: { t: T; apiKey?: string; compact?: boolean }) {
  const [client, setClient] = useState<ConnectClient>('claude-code')
  const [copied, setCopied] = useState(false)
  const key = apiKey ?? t.connect.placeholder
  const { file, code } = connectConfig(client, key)

  const copy = () => {
    void copyText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className={clsx('flex gap-5 overflow-x-auto border-b border-fg/[0.08] [scrollbar-width:none]', compact && 'gap-4')}>
        {CONNECT_CLIENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={client === c}
            onClick={() => setClient(c)}
            className={clsx('-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2 text-sm transition-colors', client === c ? 'border-accent font-semibold text-ink' : 'border-transparent text-text2 hover:text-ink')}
          >
            {c === 'other' ? t.connect.other : CONNECT_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-fg/[0.08] bg-[#07080A]">
        <div className="flex h-9 items-center justify-between border-b border-fg/[0.06] pl-3.5 pr-2">
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#7D838C]">
            {file ? file : (
              <>
                <TerminalWindow size={14} />
                {t.connect.terminal}
              </>
            )}
          </span>
          <button type="button" onClick={copy} className={clsx('flex h-[26px] items-center gap-1.5 rounded-[7px] border px-2.5 text-xs transition-colors', copied ? 'border-accent/40 text-accent' : 'border-white/[0.12] text-[#A9AEB6] hover:text-white')}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t.connect.copied : t.connect.copy}
          </button>
        </div>
        <pre className={clsx('overflow-x-auto px-4 py-3.5 font-mono leading-[1.7] text-[#E6E8EB]', compact ? 'text-[12px]' : 'text-[13px]')}>
          {code.split('\n').map((line, i) => (
            <div key={i}>{renderLine(line, key, i === 0 && !file)}</div>
          ))}
        </pre>
      </div>
    </div>
  )
}

/** 代码行：密钥（或占位文字）标成金色，终端命令的第一个词标成主色 */
function renderLine(line: string, key: string, command: boolean): ReactNode {
  const parts = line.split(key)
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="text-[#F2C94C]">{key}</span>}
      {command && i === 0 ? (
        <>
          <span className="text-[#3DDC97]">{part.split(' ')[0]}</span>
          {part.slice(part.split(' ')[0]!.length)}
        </>
      ) : (
        part
      )}
    </Fragment>
  ))
}

function ConnectPanel({ t }: { t: T }) {
  const ICONS = [DownloadSimple, MagnifyingGlass, PlugsConnected]
  return (
    <section className="grid overflow-hidden rounded-xl border border-fg/[0.08] bg-surface lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-3.5 p-5">
        <div>
          <h2 className="text-[15px] font-semibold">{t.connect.title}</h2>
          <p className="mt-1 text-sm text-text3">{t.connect.desc}</p>
        </div>
        <ConnectCode t={t} />
        <p className="flex gap-1.5 text-xs leading-relaxed text-text3">
          <Info size={14} className="mt-px shrink-0" />
          {t.connect.note}
        </p>
      </div>
      <div className="flex flex-col gap-3 border-t border-fg/[0.08] bg-fg/[0.012] p-5 lg:border-l lg:border-t-0">
        <h3 className="text-[13px] font-semibold">{t.examples.title}</h3>
        {t.examples.items.map((text, i) => {
          const I = ICONS[i] ?? PlugsConnected
          return (
            <p key={text} className="flex gap-2.5 rounded-[10px] border border-fg/[0.06] bg-fg/[0.025] px-3 py-2.5 text-sm leading-relaxed text-text2">
              <I size={15} className="mt-[3px] shrink-0 text-accent" />“{text}”
            </p>
          )
        })}
        <p className="text-[11px] text-text3">{t.examples.footnote}</p>
      </div>
    </section>
  )
}

/** 弹窗外壳：遮罩 + 居中的卡片，进出有动画 */
function Modal({ open, onOpenChange, width, children, lock }: { open: boolean; onOpenChange: (open: boolean) => void; width: number; children: ReactNode; lock?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined} onInteractOutside={lock ? (e) => e.preventDefault() : undefined}>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-fg/10 bg-surface shadow-[0_40px_80px_-20px_rgba(0,0,0,0.8)]"
                style={{ width: `min(${width}px, calc(100vw - 32px))` }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

const CloseButton = ({ label }: { label: string }) => (
  <Dialog.Close aria-label={label} className="grid size-[30px] shrink-0 place-items-center rounded-lg text-text3 transition-colors hover:bg-fg/[0.06] hover:text-ink">
    <X size={16} />
  </Dialog.Close>
)

function CreateDialog({ open, onOpenChange, t, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; t: T; onCreated: (key: string) => void }) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState<Expiry>(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(Date.now)
  const d = t.createDialog

  const change = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setName('')
      setExpiry(90)
      setError(null)
    }
  }

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { key } = await createKey(name.trim(), expiry)
      setName('')
      setExpiry(90)
      onCreated(key)
    } catch (err) {
      setError((err as { code?: string }).code === 'limit_reached' ? t.limit(KEYS_MAX) : d.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={change} width={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <Dialog.Title className="text-[17px] font-semibold text-ink">{d.title}</Dialog.Title>
            <p className="mt-1 text-sm text-text3">{d.desc}</p>
          </div>
          <CloseButton label={t.cancel} />
        </div>
        <div className="flex flex-col gap-5 px-6 pb-6 pt-5">
          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-sm font-medium">
              {d.name}
              <span className="text-xs font-normal text-text3">{d.nameMax(NAME_MAX)}</span>
            </span>
            <input
              autoFocus
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={d.namePlaceholder}
              className="h-10 rounded-[10px] border border-fg/[0.12] bg-fg/[0.04] px-3 text-sm outline-none transition-colors placeholder:text-text3 focus:border-accent/70"
            />
            <span className="text-xs text-text3">{d.nameHint}</span>
          </label>
          <div className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-sm font-medium">
              {d.expiry}
              <span className="text-xs font-normal text-text3">{expiry === null ? d.expiryLabel(null) : d.expiresOn(ymd(new Date(now + expiry * 86_400_000)))}</span>
            </span>
            <div role="radiogroup" className="grid h-[38px] grid-cols-4 gap-[3px] rounded-[10px] border border-fg/[0.08] bg-fg/[0.03] p-[3px]">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  role="radio"
                  aria-checked={expiry === option}
                  onClick={() => setExpiry(option)}
                  className={clsx('rounded-[7px] text-sm transition-colors', expiry === option ? 'bg-fg/[0.09] font-semibold text-ink' : 'text-text2 hover:text-ink')}
                >
                  {d.expiryLabel(option)}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="flex items-center gap-1.5 text-sm text-[#F2555A]">
              <Warning size={15} />
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-fg/[0.06] px-5 py-4">
          <Dialog.Close type="button" className="h-9 rounded-[10px] border border-fg/[0.12] px-4 text-sm transition-colors hover:border-fg/25">
            {t.cancel}
          </Dialog.Close>
          <button type="submit" disabled={!name.trim() || busy} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-110 disabled:opacity-50">
            {busy && <CircleNotch size={14} className="animate-spin" />}
            {d.submit}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 创建成功：完整密钥只在这里显示一次；点遮罩不关闭，免得没复制就关掉 */
function DoneDialog({ apiKey, onClose, t }: { apiKey: string | null; onClose: () => void; t: T }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState<string | null>(null)
  if (apiKey && apiKey !== shown) {
    setShown(apiKey)
    setCopied(false)
  }
  const d = t.doneDialog
  const key = apiKey ?? shown ?? ''
  return (
    <Modal open={!!apiKey} onOpenChange={(open) => !open && onClose()} width={600} lock>
      <div className="flex items-start gap-3.5 px-6 pt-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
          <CheckCircle size={22} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <Dialog.Title className="text-[17px] font-semibold text-ink">{d.title}</Dialog.Title>
        </div>
        <CloseButton label={m.detail.feedbackForm.close} />
      </div>
      <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
        <p className="flex items-center gap-2.5 rounded-[10px] border border-[#F2C94C]/30 bg-[#F2C94C]/[0.08] px-3 py-2.5 text-sm text-gold">
          <Warning size={16} className="shrink-0" />
          {d.warn}
        </p>
        <div className="flex gap-2">
          <code className="flex h-[42px] min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-[10px] border border-fg/[0.12] bg-[#07080A] px-3.5 font-mono text-sm text-[#E6E8EB]">{key}</code>
          <button
            type="button"
            onClick={() => {
              void copyText(key)
              setCopied(true)
            }}
            className={clsx('flex h-[42px] shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-sm font-semibold transition-colors', copied ? 'border-accent/40 bg-accent/10 text-accent' : 'border-fg/[0.12] bg-fg/[0.04] hover:border-fg/25')}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t.connect.copied : t.connect.copy}
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-medium">{d.withConfig}</p>
          <ConnectCode t={t} apiKey={key} compact />
        </div>
      </div>
      <div className="flex justify-end border-t border-fg/[0.06] px-5 py-4">
        <Dialog.Close className="h-9 rounded-[10px] bg-accent px-4 text-sm font-semibold text-accent-ink transition-[filter] hover:brightness-110">{d.done}</Dialog.Close>
      </div>
    </Modal>
  )
}

function RevokeDialog({ target, onClose, t }: { target: ApiKey | null; onClose: () => void; t: T }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [last, setLast] = useState<ApiKey | null>(null)
  if (target && target !== last) {
    setLast(target)
    setFailed(false)
  }
  const k = target ?? last
  const d = t.revokeDialog
  if (!k) return null

  const confirm = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await removeKey(k.id)
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!target} onOpenChange={(open) => !open && onClose()} width={460}>
      <div className="flex gap-3.5 px-6 pb-5 pt-6">
        <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-[#F2555A]/10 text-[#F2555A]">
          <Warning size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <Dialog.Title className="text-base font-semibold text-ink">{k.expired ? d.removeTitle(k.name) : d.title(k.name)}</Dialog.Title>
          <p className="mt-2 text-sm leading-relaxed text-text2">{k.expired ? d.removeDesc : d.desc}</p>
          <p className="mt-3">
            <span className="rounded-md border border-fg/[0.07] bg-fg/[0.03] px-2 py-0.5 font-mono text-xs text-text2">{k.hint}</span>
          </p>
          {failed && <p className="mt-3 text-sm text-[#F2555A]">{d.failed}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2.5 border-t border-fg/[0.06] px-5 py-4">
        <Dialog.Close className="h-9 rounded-[10px] border border-fg/[0.12] px-4 text-sm transition-colors hover:border-fg/25">{t.cancel}</Dialog.Close>
        <button type="button" onClick={() => void confirm()} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-[#E5484D] px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60">
          {busy && <CircleNotch size={14} className="animate-spin" />}
          {k.expired ? d.confirmRemove : d.confirm}
        </button>
      </div>
    </Modal>
  )
}
