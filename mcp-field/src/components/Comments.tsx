import { AnimatePresence, motion } from 'motion/react'
import { ArrowBendUpLeft, ChatsCircle, Confetti, FileText, GithubLogo, Heart, RocketLaunch, Smiley, ThumbsUp, type Icon } from '@phosphor-icons/react'
import { Fragment, useRef, useState } from 'react'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'
import { commentCount, getComments, type Comment, type CommentTarget, type Reactions } from '../lib/comments'
import { parseJson, useStorage } from '../lib/storage'

const REACTIONS: [keyof Reactions, Icon, string][] = [
  ['up', ThumbsUp, '#9FC6FF'],
  ['party', Confetti, '#F2C94C'],
  ['heart', Heart, '#E5484D'],
  ['rocket', RocketLaunch, '#D9944A'],
]
const KEY = 'mcpfield.reactions'

/** 只渲染行内代码，其余作为普通文本，避免注入 HTML */
function InlineMd({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={i} className="mx-0.5 rounded-[5px] border border-white/[0.08] bg-white/[0.07] px-1.5 py-px font-mono text-[13px] text-ink">{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function ReactionBar({ id, counts, onReply }: { id: string; counts: Partial<Reactions>; onReply?: () => void }) {
  const { m } = useI18n()
  // 自己点过的回应保存在本地；服务端渲染时为空，水合后再读取
  const [raw, setRaw] = useStorage(KEY)
  const all = parseJson<Record<string, string[]>>(raw, {})
  const mine = all[id] ?? []
  const [picker, setPicker] = useState(false)
  const toggle = (r: string) => {
    const next = mine.includes(r) ? mine.filter((x) => x !== r) : [...mine, r]
    setRaw(JSON.stringify({ ...all, [id]: next }))
    setPicker(false)
  }
  const shown = REACTIONS.filter(([k]) => (counts[k] ?? 0) > 0 || mine.includes(k))
  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {shown.map(([k, I, color]) => {
        const on = mine.includes(k)
        const n = (counts[k] ?? 0) + (on ? 1 : 0)
        return (
          <motion.button
            key={k}
            layout
            whileTap={{ scale: 0.9 }}
            onClick={() => toggle(k)}
            aria-pressed={on}
            className={clsx('flex h-[26px] items-center gap-1 rounded-full border px-2 text-xs transition-colors', on ? 'border-accent/40 bg-accent/10 text-[#9FF0CB]' : 'border-white/[0.1] bg-white/[0.04] text-text2 hover:border-white/20')}
          >
            <I size={13} weight="fill" style={{ color }} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={n} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 6, opacity: 0 }} className="tabular-nums">{n}</motion.span>
            </AnimatePresence>
          </motion.button>
        )
      })}
      <button onClick={() => setPicker((v) => !v)} aria-label={m.comments.react} className="grid size-[26px] place-items-center rounded-full border border-white/[0.1] text-text3 transition-colors hover:text-ink">
        <Smiley size={13} />
      </button>
      <AnimatePresence>
        {picker && (
          <motion.div initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="absolute bottom-8 left-0 z-20 flex gap-1 rounded-full border border-white/[0.12] bg-[#181B20] p-1 shadow-xl">
            {REACTIONS.map(([k, I, color]) => (
              <motion.button key={k} whileHover={{ scale: 1.2, y: -2 }} onClick={() => toggle(k)} className={clsx('grid size-7 place-items-center rounded-full', mine.includes(k) && 'bg-white/10')}>
                <I size={15} weight="fill" style={{ color }} />
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {onReply && (
        <button onClick={onReply} className="ml-1.5 flex items-center gap-1 text-xs text-text3 hover:text-ink"><ArrowBendUpLeft size={13} />{m.comments.reply}</button>
      )}
    </div>
  )
}

function CommentItem({ c, target, nested, onReply }: { c: Comment; target: string; nested?: boolean; onReply: (author: string) => void }) {
  const { m, tr } = useI18n()
  return (
    <div className={clsx('flex gap-3', nested ? 'pt-4' : 'border-b border-white/[0.06] py-[18px]')}>
      <span className={clsx('grid shrink-0 place-items-center rounded-full font-bold text-white', nested ? 'size-7 text-xs' : 'size-[34px] text-sm')} style={{ background: c.color }}>{c.author[0].toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{c.author}</span>
          {c.maintainer && <span className="rounded-[5px] border border-accent/30 bg-accent/10 px-1.5 text-xs text-[#9FF0CB]">{m.comments.maintainer}</span>}
          <span className="text-xs text-text3">{m.comments.ago(c.days)}</span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-text2"><InlineMd text={tr(c.body)} /></p>
        <div className="mt-2.5"><ReactionBar id={`${target}/${c.id}`} counts={c.reactions} onReply={nested ? undefined : () => onReply(c.author)} /></div>
        {c.replies?.map((r) => <CommentItem key={r.id} c={r} target={target} nested onReply={onReply} />)}
      </div>
    </div>
  )
}

/** 通用评论区：按评论对象读取数据，四类详情页共用 */
export function Comments({ target }: { target: CommentTarget }) {
  const comments = getComments(target)
  const { m } = useI18n()
  const t = m.comments
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [text, setText] = useState('')
  const [hint, setHint] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const count = commentCount(target)

  const reply = (author: string) => {
    setTab('edit')
    setText((v) => (v.startsWith(`@${author} `) ? v : `@${author} ${v}`))
    area.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => area.current?.focus(), 300)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
          <ChatsCircle size={22} className="text-accent" />{t.title}
          <span className="rounded-full bg-white/10 px-2 py-0.5 tabular-nums text-xs font-normal text-text2">{count}</span>
        </h2>
        <span className="text-sm text-text3">{t.newest}</span>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-white/10 bg-surface focus-within:border-white/25">
        <div className="flex gap-5 border-b border-white/[0.06] px-3.5">
          {(['edit', 'preview'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)} className={clsx('relative py-2.5 text-sm', tab === k ? 'font-medium text-ink' : 'text-text3 hover:text-ink')}>
              {k === 'edit' ? t.edit : t.preview}
              {tab === k && <motion.span layoutId="comment-tab" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink" />}
            </button>
          ))}
        </div>
        {tab === 'edit' ? (
          <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} rows={3} className="block min-h-[88px] w-full resize-y bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-text3" />
        ) : (
          <div className="min-h-[88px] whitespace-pre-wrap px-4 py-3.5 text-sm text-text2">{text.trim() ? <InlineMd text={text} /> : <span className="text-text3">{t.nothing}</span>}</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] bg-white/[0.015] py-2.5 pl-4 pr-3">
          <span className="flex items-center gap-1.5 text-xs text-text3"><FileText size={14} />{hint ? t.loginHint : t.markdown}</span>
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => setHint(true)} className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[9px] bg-ink px-3.5 text-sm font-semibold text-bg">
            <GithubLogo size={15} weight="fill" />{t.login}
          </motion.button>
        </div>
      </div>

      {comments.length ? (
        <div>{comments.map((c) => <CommentItem key={c.id} c={c} target={target} onReply={reply} />)}</div>
      ) : (
        <p className="rounded-[14px] border border-dashed border-white/15 px-6 py-10 text-center text-sm text-text3">{t.empty}</p>
      )}
    </div>
  )
}
