import { CheckCircle, CircleNotch, MagicWand, Stop, WarningCircle, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { AiEvent, AiOptions, ImageSource } from '../lib/blog'
import { Button } from './ui'

/* 编辑器里的 AI 生成：对话框（写正文、一键生成全部）和生成进度面板 */

const input = 'h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-text3 focus:border-text3'

export interface ImageChoice {
  count: number
  source: ImageSource
}

export interface BodyParams {
  direction: string
  keywords: string
  notes: string
  images: ImageChoice
}

export interface AllParams extends BodyParams {
  cover: ImageSource | 'none'
}

function Modal({ title, sub, onClose, children, footer }: { title: string; sub?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-[560px] flex-col rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <MagicWand className="size-[18px] text-accent" />
              {title}
            </h2>
            {sub && <p className="mt-1 text-xs text-text3">{sub}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-text3 hover:bg-white/5 hover:text-ink" aria-label="关闭">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        <footer className="flex flex-wrap justify-end gap-2.5 border-t border-line px-4 py-4 sm:px-6">{footer}</footer>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text2">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-text3">{hint}</span>}
    </div>
  )
}

/** 主题方向：预设里选一个，或者自己写一句 */
function DirectionPicker({ options, value, onChange }: { options: AiOptions; value: string; onChange: (v: string) => void }) {
  const preset = options.directions.find((d) => d.id === value)
  const [custom, setCustom] = useState(preset ? '' : value)
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-2">
        {options.directions.map((d) => (
          <button
            key={d.id}
            type="button"
            title={d.guide}
            onClick={() => onChange(d.id)}
            className={clsx('h-8 rounded-lg border px-3 text-[13px] transition-colors', value === d.id ? 'border-accent/60 bg-accent/10 font-medium text-accent' : 'border-line text-text2 hover:border-text3 hover:text-ink')}
          >
            {d.label}
          </button>
        ))}
      </div>
      <input
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value)
          onChange(e.target.value.trim() ? e.target.value : options.directions[0]!.id)
        }}
        placeholder="或者自己写方向，例如：给第一次接触 MCP 的产品经理讲清楚它能做什么"
        className={clsx(input, !preset && custom.trim() && 'border-accent/60')}
      />
      {preset && <span className="text-[11px] leading-snug text-text3">{preset.guide}</span>}
    </div>
  )
}

/** 插图：张数和来源；没配置的来源不能选 */
function ImagePicker({ options, value, onChange, label = '正文插图' }: { options: AiOptions; value: ImageChoice; onChange: (v: ImageChoice) => void; label?: string }) {
  const available = { ai: options.image, stock: options.stock }
  return (
    <Field label={label} hint={!options.image && !options.stock ? '还没有配置生图模型或 Pexels 图库，去「AI 设置」里配置后才能插图' : undefined}>
      <div className="flex items-center gap-3">
        <select value={value.count} onChange={(e) => onChange({ ...value, count: Number(e.target.value) })} className="h-9 w-28 shrink-0 cursor-pointer rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-text3" disabled={!options.image && !options.stock}>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n} className="bg-surface">
              {n === 0 ? '不插图' : `${n} 张`}
            </option>
          ))}
        </select>
        {(['ai', 'stock'] as const).map((s) => (
          <label key={s} className={clsx('flex items-center gap-1.5 whitespace-nowrap text-[13px]', available[s] ? 'cursor-pointer text-text2' : 'cursor-not-allowed text-text3/60')}>
            <input type="radio" checked={value.source === s} disabled={!available[s] || value.count === 0} onChange={() => onChange({ ...value, source: s })} className="accent-[var(--mf-accent)]" />
            {s === 'ai' ? 'AI 生图' : 'Pexels 图库'}
          </label>
        ))}
      </div>
    </Field>
  )
}

const defaultSource = (o: AiOptions): ImageSource => (o.image ? 'ai' : 'stock')

function NotConfigured() {
  return (
    <p className="rounded-lg border border-warn/30 bg-warn/5 px-3.5 py-2.5 text-xs leading-relaxed text-warn">
      还没有配置文本模型，先去{' '}
      <Link to="/settings" className="underline">
        AI 设置
      </Link>{' '}
      填好 Base URL、API Key 和模型名。
    </p>
  )
}

/** 写正文：基于当前标题 */
export function BodyDialog({ options, title, onClose, onStart }: { options: AiOptions; title: string; onClose: () => void; onStart: (p: BodyParams) => void }) {
  const [p, setP] = useState<BodyParams>({ direction: options.directions[0]!.id, keywords: '', notes: '', images: { count: options.image || options.stock ? 2 : 0, source: defaultSource(options) } })
  return (
    <Modal
      title="AI 写正文"
      sub={title ? `标题：${title}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button primary onClick={() => onStart(p)} disabled={!options.text || !title.trim()}>
            开始生成
          </Button>
        </>
      }
    >
      {!options.text && <NotConfigured />}
      {!title.trim() && <p className="text-xs text-warn">先填写文章标题，正文围绕标题来写；没有标题时用右上角的“AI 一键生成”。</p>}
      <Field label="主题方向">
        <DirectionPicker options={options} value={p.direction} onChange={(direction) => setP({ ...p, direction })} />
      </Field>
      <Field label="关键词（可选）" hint="用来在站内找相关的 MCP 服务、客户端、Skill 作为素材；逗号分隔">
        <input value={p.keywords} onChange={(e) => setP({ ...p, keywords: e.target.value })} placeholder="claude code, oauth, 远程服务" className={input} />
      </Field>
      <Field label="想写到的要点（可选）">
        <textarea value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} rows={3} placeholder="每行一条，例如：要讲清楚 401 怎么排查" className="resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-text3 focus:border-text3" />
      </Field>
      <ImagePicker options={options} value={p.images} onChange={(images) => setP({ ...p, images })} />
    </Modal>
  )
}

/** 一键生成全部：只给方向和关键词，标题、地址、标签、摘要、正文、封面都由 AI 生成 */
export function AllDialog({ options, onClose, onStart }: { options: AiOptions; onClose: () => void; onStart: (p: AllParams) => void }) {
  const canImage = options.image || options.stock
  const [p, setP] = useState<AllParams>({ direction: options.directions[0]!.id, keywords: '', notes: '', images: { count: canImage ? 2 : 0, source: defaultSource(options) }, cover: options.image ? 'ai' : options.stock ? 'stock' : 'none' })
  return (
    <Modal
      title="AI 一键生成全部内容"
      sub="标题、地址、标签、摘要、正文和封面都由 AI 生成，生成后可以再修改"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button primary onClick={() => onStart(p)} disabled={!options.text || !p.keywords.trim()}>
            开始生成
          </Button>
        </>
      }
    >
      {!options.text && <NotConfigured />}
      <Field label="主题方向">
        <DirectionPicker options={options} value={p.direction} onChange={(direction) => setP({ ...p, direction })} />
      </Field>
      <Field label="关键词" hint="文章围绕这些词来写，也用来在站内找相关条目作为素材；逗号分隔">
        <input value={p.keywords} onChange={(e) => setP({ ...p, keywords: e.target.value })} placeholder="例如：postgres, 数据库, MCP 服务" className={input} autoFocus />
      </Field>
      <Field label="想写到的要点（可选）">
        <textarea value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} rows={3} placeholder="每行一条" className="resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-text3 focus:border-text3" />
      </Field>
      <ImagePicker options={options} value={p.images} onChange={(images) => setP({ ...p, images })} />
      <Field label="封面">
        <div className="flex items-center gap-4">
          {(
            [
              ['ai', 'AI 生图', options.image],
              ['stock', 'Pexels 图库', options.stock],
              ['none', '不生成', true],
            ] as const
          ).map(([v, label, ok]) => (
            <label key={v} className={clsx('flex items-center gap-1.5 whitespace-nowrap text-[13px]', ok ? 'cursor-pointer text-text2' : 'cursor-not-allowed text-text3/60')}>
              <input type="radio" checked={p.cover === v} disabled={!ok} onChange={() => setP({ ...p, cover: v })} className="accent-[var(--mf-accent)]" />
              {label}
            </label>
          ))}
        </div>
      </Field>
    </Modal>
  )
}

/* ========== 进度 ========== */

type StageKey = Extract<AiEvent, { type: 'stage' }>['stage']

export interface Progress {
  label: string
  /** 出现过的阶段：最后一个是当前阶段 */
  stages: { stage: StageKey; message: string }[]
  materials: { name: string; path: string }[] | null
  images: { ok: number; failed: number }
  warnings: string[]
  /** 结束：成功为 true，失败或取消为 false，进行中为 null */
  done: boolean | null
  error?: string
}

export const newProgress = (label: string): Progress => ({ label, stages: [], materials: null, images: { ok: 0, failed: 0 }, warnings: [], done: null })

/** 把一个事件记进进度（正文、标题等内容的回填由编辑器处理） */
export function track(p: Progress, e: AiEvent): Progress {
  switch (e.type) {
    case 'stage':
      return { ...p, stages: [...p.stages.filter((s) => s.stage !== e.stage), { stage: e.stage, message: e.message }] }
    case 'materials':
      return { ...p, materials: e.items }
    case 'image':
      return { ...p, images: e.markdown ? { ...p.images, ok: p.images.ok + 1 } : { ...p.images, failed: p.images.failed + 1 }, warnings: e.error ? [...p.warnings, `插图失败：${e.error}`] : p.warnings }
    case 'warning':
      return { ...p, warnings: [...p.warnings, e.message] }
    case 'done':
      return { ...p, done: true }
    default:
      return p
  }
}

/** 生成进度：右下角浮层，列出各阶段、站内素材、警告，可以停止 */
export function ProgressPanel({ progress, onStop, onClose }: { progress: Progress; onStop: () => void; onClose: () => void }) {
  const running = progress.done === null
  const current = progress.stages.at(-1)?.stage
  return (
    <div className="fixed inset-x-3 bottom-3 z-40 flex flex-col sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[340px] gap-3 rounded-xl border border-line bg-surface p-4 shadow-2xl">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {running ? <CircleNotch className="size-4 animate-spin text-accent" /> : progress.done ? <CheckCircle className="size-4 text-ok" /> : <WarningCircle className="size-4 text-err" />}
          {progress.label}
          {!running && (progress.done ? '完成' : '未完成')}
        </span>
        {running ? (
          <button onClick={onStop} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text2 hover:bg-white/5 hover:text-err">
            <Stop className="size-3.5" weight="fill" />
            停止
          </button>
        ) : (
          <button onClick={onClose} className="rounded-md p-1 text-text3 hover:bg-white/5 hover:text-ink" aria-label="关闭">
            <X className="size-4" />
          </button>
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {progress.stages.map((s) => {
          const active = running && s.stage === current
          return (
            <li key={s.stage} className={clsx('flex items-center gap-2 text-xs', active ? 'text-ink' : 'text-text3')}>
              {active ? <CircleNotch className="size-3.5 animate-spin text-accent" /> : <CheckCircle className="size-3.5 text-ok" />}
              {s.message.replace(/^正在/, active ? '正在' : '')}
              {s.stage === 'materials' && progress.materials && <span className="text-text3">· 找到 {progress.materials.length} 个</span>}
              {s.stage === 'images' && progress.images.ok + progress.images.failed > 0 && <span className="text-text3">· 完成 {progress.images.ok} 张{progress.images.failed ? `，失败 ${progress.images.failed} 张` : ''}</span>}
            </li>
          )
        })}
      </ol>
      {progress.materials && progress.materials.length > 0 && (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-text3">站内素材：{progress.materials.map((m) => m.name).join('、')}</p>
      )}
      {(progress.warnings.length > 0 || progress.error) && (
        <ul className="flex flex-col gap-1 border-t border-line pt-2.5">
          {progress.error && <li className="text-[11px] leading-snug text-err">{progress.error}</li>}
          {progress.warnings.map((w, i) => (
            <li key={i} className="text-[11px] leading-snug text-warn">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
