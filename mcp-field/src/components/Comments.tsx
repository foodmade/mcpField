import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowBendUpLeft, CaretDown, ChatsCircle, Check, Confetti, FileText, Heart, RocketLaunch, SignIn, Smiley, ThumbsUp, Trash, type Icon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import type { Messages } from '../i18n/messages'
import { ApiError } from '../lib/api/http'
import { useSession } from '../lib/auth'
import { colorOf, COMMENT_SORTS, useComments, type Comment, type CommentSort, type CommentTarget, type Reaction } from '../lib/comments'

const REACTIONS: [Reaction, Icon, string][] = [
  ['up', ThumbsUp, '#9FC6FF'],
  ['party', Confetti, '#F2C94C'],
  ['heart', Heart, '#E5484D'],
  ['rocket', RocketLaunch, '#D9944A'],
]
const BODY_MAX = 5000

/** 登录页地址，登录后回到当前页面 */
function useLoginHref() {
  const { to } = useI18n()
  const { pathname, search } = useLocation()
  return `${to('/login')}?redirect=${encodeURIComponent(pathname + search)}`
}

function errorText(error: unknown, t: Messages['comments']): string {
  if (!(error instanceof ApiError)) return t.errors.failed
  if (error.code === 'rate_limited') return t.errors.rateLimited
  if (error.status === 401) return t.errors.unauthorized
  if (error.status === 0) return t.errors.network
  return t.errors.failed
}

/** 用户写的 Markdown：不渲染原始 HTML，外链加 nofollow */
function CommentBody({ text }: { text: string }) {
  return (
    <div className="comment-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={['img']}
        components={{ a: ({ node: _node, ...p }) => <a {...p} target="_blank" rel="nofollow ugc noopener noreferrer" /> }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function Avatar({ c, size }: { c: Comment; size: 'md' | 'sm' }) {
  const cls = clsx('grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white', size === 'md' ? 'size-[34px] text-sm' : 'size-7 text-xs')
  if (c.avatar) return <img src={c.avatar} alt="" referrerPolicy="no-referrer" className={clsx(cls, 'object-cover')} />
  return <span className={cls} style={{ background: colorOf(c.author) }}>{[...c.author][0]?.toUpperCase()}</span>
}

/** onGuest：未登录时点击任何回应按钮都只调用它（提示先登录），不打开选择器 */
function ReactionBar({ c, onToggle, onGuest }: { c: Comment; onToggle: (r: Reaction) => void; onGuest?: () => void }) {
  const { m } = useI18n()
  const [picker, setPicker] = useState(false)
  const toggle = (r: Reaction) => {
    setPicker(false)
    if (onGuest) onGuest()
    else onToggle(r)
  }
  const shown = REACTIONS.filter(([k]) => (c.reactions[k] ?? 0) > 0 || c.mine.includes(k))
  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {shown.map(([k, I, color]) => {
        const on = c.mine.includes(k)
        const n = c.reactions[k] ?? 0
        return (
          <motion.button
            key={k}
            layout
            whileTap={{ scale: 0.9 }}
            onClick={() => toggle(k)}
            aria-pressed={on}
            className={clsx('flex h-[26px] items-center gap-1 rounded-full border px-2 font-mono text-[11px] transition-colors', on ? 'border-accent/25 bg-accent/10 text-mint' : 'border-fg/[0.08] bg-fg/[0.04] text-text2 hover:border-fg/20')}
          >
            <I size={13} weight="bold" style={{ color }} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={n} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 6, opacity: 0 }} className="tabular-nums">{n}</motion.span>
            </AnimatePresence>
          </motion.button>
        )
      })}
      <button onClick={() => (onGuest ? onGuest() : setPicker((v) => !v))} aria-label={m.comments.react} className="grid size-[26px] place-items-center rounded-full border border-fg/10 text-text3 transition-colors hover:text-ink">
        <Smiley size={13} />
      </button>
      <AnimatePresence>
        {picker && (
          <motion.div initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute bottom-8 left-0 z-20 flex gap-1 rounded-full border border-fg/[0.12] bg-subtle p-1 shadow-xl">
            {REACTIONS.map(([k, I, color]) => (
              <motion.button key={k} whileHover={{ scale: 1.2, y: -2 }} onClick={() => toggle(k)} className={clsx('grid size-7 place-items-center rounded-full', c.mine.includes(k) && 'bg-fg/10')}>
                <I size={15} weight="bold" style={{ color }} />
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 编辑 / 预览 + 底栏；未登录时底栏按钮去登录页，登录后回到当前页面 */
function Composer({ placeholder, compact, onSubmit, onCancel }: { placeholder: string; compact?: boolean; onSubmit: (body: string) => Promise<void>; onCancel?: () => void }) {
  const { m } = useI18n()
  const t = m.comments
  const { user, pending } = useSession()
  const login = useLoginHref()
  const tabId = useId()
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const body = text.trim()

  useEffect(() => {
    if (compact) area.current?.focus()
  }, [compact])

  const submit = async () => {
    if (!user || !body || busy) return
    if (body.length > BODY_MAX) return setError(t.errors.tooLong)
    setBusy(true)
    setError(null)
    try {
      await onSubmit(body)
      setText('')
      setTab('edit')
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-fg/10 bg-surface focus-within:border-fg/25">
      <div className="flex gap-[18px] border-b border-fg/[0.06] px-3.5">
        {(['edit', 'preview'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={clsx('relative py-2.5 text-[13px]', tab === k ? 'font-medium text-ink' : 'text-text3 hover:text-ink')}>
            {k === 'edit' ? t.edit : t.preview}
            {tab === k && <motion.span layoutId={`comment-tab-${tabId}`} className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
          </button>
        ))}
      </div>
      {tab === 'edit' ? (
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            else if (e.key === 'Escape' && onCancel) onCancel()
          }}
          placeholder={placeholder}
          rows={compact ? 2 : 3}
          className={clsx('block w-full resize-y bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-text3', compact ? 'min-h-[72px]' : 'min-h-[88px]')}
        />
      ) : (
        <div className={clsx('px-4 py-3.5', compact ? 'min-h-[72px]' : 'min-h-[88px]')}>{body ? <CommentBody text={text} /> : <span className="text-sm text-text3">{t.nothing}</span>}</div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-fg/[0.06] bg-fg/[0.015] py-2.5 pl-4 pr-3">
        {error ? (
          <span role="alert" className="text-xs text-rose">{error}</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-text3"><FileText size={14} />{t.markdown}</span>
        )}
        <div className="flex items-center gap-2">
          {onCancel && <button onClick={onCancel} className="h-[34px] px-2.5 text-[13px] text-text3 hover:text-ink">{t.cancel}</button>}
          {user ? (
            <motion.button whileTap={{ scale: 0.96 }} disabled={!body || busy} onClick={() => void submit()} className="flex h-[34px] items-center whitespace-nowrap rounded-[9px] bg-ink px-3.5 text-[13px] font-semibold text-bg transition-opacity disabled:opacity-40">
              {compact ? t.reply : t.post}
            </motion.button>
          ) : (
            <Link to={login} className={clsx('flex h-[34px] items-center gap-[7px] whitespace-nowrap rounded-[9px] bg-ink px-3.5 text-[13px] font-semibold text-bg transition-transform active:scale-[0.96]', pending && 'invisible')}>
              <SignIn size={15} />{t.login}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function CommentItem({ c, nested, onReply, onRemove, onReact, children }: { c: Comment; nested?: boolean; onReply?: () => void; onRemove: (id: string) => void; onReact: (id: string, r: Reaction) => Promise<void>; children?: ReactNode }) {
  const { m } = useI18n()
  const t = m.comments
  const { user } = useSession()
  const login = useLoginHref()
  const [now] = useState(Date.now)
  // 游客点回应、回复时在操作栏末尾提示先登录，3 秒后自动消失
  const [hint, setHint] = useState(0)
  const at = new Date(c.createdAt)
  const minutes = Math.max(0, Math.floor((now - at.getTime()) / 60000))
  const askLogin = () => setHint((n) => n + 1)

  useEffect(() => {
    if (!hint) return
    const id = setTimeout(() => setHint(0), 3000)
    return () => clearTimeout(id)
  }, [hint])

  // 登录过期（401）同样提示先登录，其余失败只恢复原状
  const react = (r: Reaction) => void onReact(c.id, r).catch((e: unknown) => e instanceof ApiError && e.status === 401 && askLogin())

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={clsx('flex gap-3', nested ? 'pt-3.5' : 'border-b border-fg/[0.06] py-[18px]')}>
      <Avatar c={c} size={nested ? 'sm' : 'md'} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{c.author}</span>
          <time dateTime={c.createdAt} title={at.toLocaleString()} className="text-xs text-text3">{t.ago(minutes)}</time>
        </div>
        <CommentBody text={c.body} />
        <div className="flex flex-wrap items-center gap-1.5">
          <ReactionBar c={c} onToggle={react} onGuest={user ? undefined : askLogin} />
          {onReply && <button onClick={user ? onReply : askLogin} className="ml-1.5 flex items-center gap-1 text-xs text-text3 hover:text-ink"><ArrowBendUpLeft size={13} />{t.reply}</button>}
          {c.own && (
            <button onClick={() => window.confirm(t.removeConfirm) && onRemove(c.id)} className="ml-1.5 flex items-center gap-1 text-xs text-text3 hover:text-rose"><Trash size={13} />{t.remove}</button>
          )}
          <AnimatePresence>
            {hint > 0 && (
              <motion.div
                role="status"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="ml-1.5 flex h-[26px] items-center gap-2 whitespace-nowrap rounded-full border border-fg/[0.12] bg-subtle px-3 text-xs text-text2"
              >
                {t.loginFirst}
                <Link to={login} className="font-semibold text-accent hover:underline">{t.signIn}</Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {children}
      </div>
    </motion.div>
  )
}

function SortPicker({ value, onChange }: { value: CommentSort; onChange: (s: CommentSort) => void }) {
  const { m } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger className="flex items-center gap-1 text-[13px] text-text2 outline-none transition-colors hover:text-ink">
        {m.comments.sorts[value]}
        <CaretDown size={12} className={clsx('transition-transform duration-300', open && 'rotate-180')} />
      </DropdownMenu.Trigger>
      <AnimatePresence>
        {open && (
          <DropdownMenu.Portal forceMount>
            <DropdownMenu.Content asChild align="end" sideOffset={6}>
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="z-50 min-w-[132px] origin-top-right rounded-xl border border-fg/[0.12] bg-subtle/95 p-1.5 shadow-[0_20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                {COMMENT_SORTS.map((key) => (
                  <DropdownMenu.Item
                    key={key}
                    onSelect={() => onChange(key)}
                    className={clsx('flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none data-[highlighted]:bg-fg/[0.07]', key === value ? 'text-ink' : 'text-text2')}
                  >
                    <span className="flex-1 whitespace-nowrap">{m.comments.sorts[key]}</span>
                    {key === value && <Check size={13} className="text-accent" />}
                  </DropdownMenu.Item>
                ))}
              </motion.div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        )}
      </AnimatePresence>
    </DropdownMenu.Root>
  )
}

/** 通用评论区：按评论对象读取数据，各类详情页共用 */
export function Comments({ target }: { target: CommentTarget }) {
  const { comments, count, hasMore, status, loadingMore, sort, setSort, reload, more, add, reply, remove, react } = useComments(target)
  const { m } = useI18n()
  const t = m.comments
  const [replying, setReplying] = useState<string | null>(null)

  const onRemove = (id: string) => {
    remove(id).catch((e: unknown) => window.alert(errorText(e, t)))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">
          <ChatsCircle size={20} className="text-accent" />
          {t.title}
          {count > 0 && <span className="rounded-full bg-fg/[0.08] px-2 py-0.5 font-mono text-xs font-normal tabular-nums text-text2">{count}</span>}
        </h2>
        {count > 1 && <SortPicker value={sort} onChange={setSort} />}
      </div>

      <Composer placeholder={status === 'ready' && count === 0 ? t.empty : t.placeholder} onSubmit={add} />

      {status === 'error' && (
        <p className="text-sm text-text3">
          {t.loadFailed} · <button onClick={reload} className="text-accent hover:underline">{t.retry}</button>
        </p>
      )}

      {comments.length > 0 && (
        <div className={clsx('transition-opacity', status === 'loading' && 'opacity-50')}>
          {comments.map((c) => (
            <CommentItem key={c.id} c={c} onReply={() => setReplying((v) => (v === c.id ? null : c.id))} onRemove={onRemove} onReact={react}>
              {c.replies?.map((r) => <CommentItem key={r.id} c={r} nested onRemove={onRemove} onReact={react} />)}
              {replying === c.id && (
                <div className="pt-3.5">
                  <Composer
                    compact
                    placeholder={t.replyTo(c.author)}
                    onSubmit={async (body) => {
                      await reply(c.id, body)
                      setReplying(null)
                    }}
                    onCancel={() => setReplying(null)}
                  />
                </div>
              )}
            </CommentItem>
          ))}
        </div>
      )}

      {hasMore && (
        <button onClick={() => void more().catch(() => undefined)} disabled={loadingMore} className="h-10 w-full rounded-[10px] border border-fg/[0.08] text-[13px] text-text2 transition-colors hover:border-fg/20 hover:text-ink disabled:opacity-60">
          {loadingMore ? t.loading : t.more}
        </button>
      )}
    </div>
  )
}
