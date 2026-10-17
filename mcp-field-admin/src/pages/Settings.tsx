import { CheckCircle, CircleNotch, Plugs, WarningCircle } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { PageHeader } from '../components/Layout'
import { Button, Card, ErrorBox, Loading } from '../components/ui'
import { api, useApi } from '../lib/api'
import type { AiSettings } from '../lib/blog'

/* AI 设置：博客 AI 生成用的文本模型、生图模型、Pexels 图库（都是 OpenAI 兼容接口，Pexels 除外） */

const input = 'h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-text3 focus:border-text3'
const SIZES = [
  ['1536x1024', '1536 × 1024（横图，推荐）'],
  ['1792x1024', '1792 × 1024（DALL·E 3 横图）'],
  ['1024x1024', '1024 × 1024（方图）'],
] as const

interface Form {
  text: { baseURL: string; model: string; apiKey: string }
  image: { baseURL: string; model: string; size: string; apiKey: string }
  stock: { apiKey: string }
}

type Target = 'text' | 'image' | 'stock'

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-text2">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-text3">{hint}</span>}
    </label>
  )
}

/** API Key 输入框：不回显已保存的 Key，留空表示不修改 */
function KeyInput({ value, saved, onChange }: { value: string; saved: { apiKey: string; hasKey: boolean }; onChange: (v: string) => void }) {
  return <input type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={saved.hasKey ? `已保存 ${saved.apiKey}，留空不修改` : 'sk-…'} className={clsx(input, 'font-mono')} />
}

function Status({ ready }: { ready: boolean }) {
  return <span className={clsx('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs', ready ? 'bg-ok/10 text-ok' : 'bg-white/5 text-text3')}>{ready ? '已配置' : '未配置'}</span>
}

export function SettingsPage() {
  const { data, error, loading, reload } = useApi<AiSettings>('/settings/blog-ai')
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tests, setTests] = useState<Partial<Record<Target, { ok: boolean; message: string }>>>({})

  useEffect(() => {
    if (data) setForm({ text: { baseURL: data.text.baseURL, model: data.text.model, apiKey: '' }, image: { baseURL: data.image.baseURL, model: data.image.model, size: data.image.size, apiKey: '' }, stock: { apiKey: '' } })
  }, [data])

  if (error) return <div className="p-8"><ErrorBox error={error} retry={reload} /></div>
  if (loading || !data || !form) return <Loading />

  const set = <S extends keyof Form>(section: S, patch: Partial<Form[S]>) => setForm((f) => (f ? { ...f, [section]: { ...f[section], ...patch } } : f))
  // 空的 Key 不提交（不修改）；clear 时提交空字符串清除
  const key = (v: string) => (v.trim() ? v.trim() : undefined)

  const save = async (clear?: Target) => {
    setBusy('save')
    setMsg(null)
    try {
      await api('/settings/blog-ai', {
        method: 'PUT',
        body: {
          text: { ...form.text, apiKey: clear === 'text' ? '' : key(form.text.apiKey) },
          image: { ...form.image, apiKey: clear === 'image' ? '' : key(form.image.apiKey) },
          stock: { apiKey: clear === 'stock' ? '' : key(form.stock.apiKey) },
        },
      })
      setMsg({ ok: true, text: '已保存' })
      setTests({})
      await reload()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const test = async (target: Target) => {
    setBusy(`test-${target}`)
    try {
      const r = await api<{ ok: boolean; message: string }>('/settings/blog-ai/test', { method: 'POST', body: { target } })
      setTests((t) => ({ ...t, [target]: r }))
    } catch (e) {
      setTests((t) => ({ ...t, [target]: { ok: false, message: (e as Error).message } }))
    } finally {
      setBusy(null)
    }
  }

  const footer = (target: Target, hasKey: boolean) => (
    <div className="mt-1 flex flex-col gap-2.5 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <Button icon={busy === `test-${target}` ? <CircleNotch className="size-[15px] animate-spin" /> : <Plugs className="size-[15px]" />} onClick={() => test(target)} disabled={!!busy}>
          测试连接
        </Button>
        {hasKey && (
          <button onClick={() => confirm('清除已保存的 API Key？') && save(target)} disabled={!!busy} className="text-xs text-text3 hover:text-err">
            清除 Key
          </button>
        )}
      </div>
      {tests[target] && (
        <p className={clsx('flex items-start gap-1.5 text-xs leading-relaxed', tests[target].ok ? 'text-ok' : 'text-err')}>
          {tests[target].ok ? <CheckCircle className="mt-px size-3.5 shrink-0" /> : <WarningCircle className="mt-px size-3.5 shrink-0" />}
          {tests[target].message}
        </p>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="AI 设置"
        sub="博客 AI 生成用的模型服务；测试连接用的是已保存的配置，改完先保存"
        actions={
          <>
            {msg && <span className={clsx('text-xs', msg.ok ? 'text-ok' : 'text-err')}>{msg.text}</span>}
            <Button primary onClick={() => save()} disabled={!!busy}>
              {busy === 'save' ? '保存中…' : '保存'}
            </Button>
          </>
        }
      />
      <div className="grid max-w-[1180px] grid-cols-3 items-start gap-5 px-8 pb-10 pt-6">
        <Card title="文本模型" sub="写摘要、正文，起标题、地址和标签" right={<Status ready={data.text.ready} />}>
          <div className="flex flex-col gap-4">
            <Field label="Base URL" hint="OpenAI 兼容接口地址，一般以 /v1 结尾">
              <input value={form.text.baseURL} onChange={(e) => set('text', { baseURL: e.target.value })} placeholder="https://api.openai.com/v1" className={clsx(input, 'font-mono')} />
            </Field>
            <Field label="API Key">
              <KeyInput value={form.text.apiKey} saved={data.text} onChange={(v) => set('text', { apiKey: v })} />
            </Field>
            <Field label="模型">
              <input value={form.text.model} onChange={(e) => set('text', { model: e.target.value })} placeholder="gpt-4.1" className={clsx(input, 'font-mono')} />
            </Field>
            {footer('text', data.text.hasKey)}
          </div>
        </Card>

        <Card title="生图模型" sub="封面和正文插图，生成后转成 WebP 存到 R2" right={<Status ready={data.image.ready} />}>
          <div className="flex flex-col gap-4">
            <Field label="Base URL" hint="OpenAI 兼容的 images/generations 接口，可以和文本模型同一个服务">
              <input value={form.image.baseURL} onChange={(e) => set('image', { baseURL: e.target.value })} placeholder="https://api.openai.com/v1" className={clsx(input, 'font-mono')} />
            </Field>
            <Field label="API Key">
              <KeyInput value={form.image.apiKey} saved={data.image} onChange={(v) => set('image', { apiKey: v })} />
            </Field>
            <Field label="模型">
              <input value={form.image.model} onChange={(e) => set('image', { model: e.target.value })} placeholder="gpt-image-1" className={clsx(input, 'font-mono')} />
            </Field>
            <Field label="尺寸" hint="封面会再裁成 16:9（1600 × 900）">
              <select value={form.image.size} onChange={(e) => set('image', { size: e.target.value })} className={clsx(input, 'cursor-pointer')}>
                {SIZES.map(([v, label]) => (
                  <option key={v} value={v} className="bg-surface">
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {footer('image', data.image.hasKey)}
          </div>
        </Card>

        <Card title="Pexels 图库" sub="正文插图也可以从图库搜实拍照片，图注带摄影师署名" right={<Status ready={data.stock.ready} />}>
          <div className="flex flex-col gap-4">
            <Field
              label="API Key"
              hint={
                <>
                  在{' '}
                  <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    pexels.com/api
                  </a>{' '}
                  免费申请；照片可以免费商用，下载后存到 R2
                </>
              }
            >
              <KeyInput value={form.stock.apiKey} saved={data.stock} onChange={(v) => set('stock', { apiKey: v })} />
            </Field>
            {footer('stock', data.stock.hasKey)}
          </div>
        </Card>
      </div>
    </>
  )
}
