import {
  ArrowLeft,
  ArrowSquareOut,
  CircleNotch,
  Code,
  CodeBlock,
  Columns,
  Eye,
  ImageSquare,
  Info,
  LinkSimple,
  MagicWand,
  ListBullets,
  ListNumbers,
  PencilSimple,
  Quotes,
  Table,
  TextB,
  TextHThree,
  TextHTwo,
  TextItalic,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AllDialog, BodyDialog, newProgress, ProgressPanel, track, type AllParams, type BodyParams, type Progress } from '../components/AiPanels'
import { useShell } from '../components/Layout'
import { MarkdownPreview } from '../components/MarkdownPreview'
import { TranslationPill } from '../components/TranslationBadge'
import { Button, ErrorBox, Loading } from '../components/ui'
import { api, useApi } from '../lib/api'
import { aiStream, LOCALE_LABEL, uploadImage, type AiEvent, type AiOptions, type BlogInput, type BlogPost, type ImageSource, type TranslateLocale } from '../lib/blog'
import { compact, dateTime } from '../lib/format'
import { KIND_LABEL, type Kind } from '../lib/labels'

const AUTHOR_KEY = 'mf-blog-author'
const input = 'h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-text3 focus:border-text3'

/** 表单里的值：标签用逗号分隔的文字编辑，发布时间用北京时间的 datetime-local */
interface Form extends Omit<BlogInput, 'tags' | 'publishedAt'> {
  tags: string
  publishedAt: string
}

const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 16) : '')
const fromLocal = (v: string) => (v ? `${v}:00+08:00` : null)

const emptyForm = (author: string): Form => ({ slug: '', title: '', summary: '', body: '', tags: '', coverUrl: null, authorName: author, status: 'draft', pinned: false, publishedAt: '' })
const formOf = (p: BlogPost): Form => ({ ...p, tags: p.tags.join(', '), publishedAt: toLocal(p.publishedAt) })
const payload = (f: Form, status: BlogInput['status']): BlogInput => ({
  ...f,
  status,
  tags: f.tags.split(/[,，\s]+/).filter(Boolean),
  coverUrl: f.coverUrl?.trim() || null,
  publishedAt: fromLocal(f.publishedAt),
})

/* ========== 正文编辑：在选区前后插入 Markdown 语法 ========== */

type Edit = (text: string, start: number, end: number) => { text: string; start: number; end: number }

/** 选区前后加符号；没选中时插入占位文字并选中它 */
const wrap =
  (before: string, after = before, placeholder = '文字'): Edit =>
  (text, start, end) => {
    const sel = text.slice(start, end) || placeholder
    return { text: text.slice(0, start) + before + sel + after + text.slice(end), start: start + before.length, end: start + before.length + sel.length }
  }

/** 选中的每一行前加前缀（标题、列表、引用） */
const prefixLines =
  (prefix: (i: number) => string): Edit =>
  (text, start, end) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineEnd = end > start && text[end - 1] === '\n' ? end - 1 : text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end)
    const lines = text.slice(lineStart, lineEnd).split('\n')
    const out = lines.map((l, i) => prefix(i) + l.replace(/^(#{1,6} |> |- |\d+\. )/, '')).join('\n')
    // 单行时只选中前缀后面的文字（空行就是光标停在前缀后），多行时选中整段
    const from = lines.length === 1 ? lineStart + prefix(0).length : lineStart
    return { text: text.slice(0, lineStart) + out + text.slice(lineEnd), start: from, end: lineStart + out.length }
  }

/** 插入独立的一段（前后各空一行） */
const block =
  (snippet: string, selectFrom = 0, selectLen = 0): Edit =>
  (text, start, end) => {
    const before = text.slice(0, start)
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const tail = text.slice(end).startsWith('\n') ? '\n' : '\n\n'
    const pos = start + lead.length
    return { text: before + lead + snippet + tail + text.slice(end), start: pos + selectFrom, end: pos + selectFrom + selectLen }
  }

const TOOLS: { icon: typeof TextB; title: string; edit: Edit; gap?: boolean }[] = [
  { icon: TextHTwo, title: '二级标题', edit: prefixLines(() => '## ') },
  { icon: TextHThree, title: '三级标题', edit: prefixLines(() => '### ') },
  { icon: TextB, title: '粗体（⌘B）', edit: wrap('**'), gap: true },
  { icon: TextItalic, title: '斜体（⌘I）', edit: wrap('*') },
  { icon: Code, title: '行内代码', edit: wrap('`', '`', 'code') },
  { icon: LinkSimple, title: '链接（⌘K）。链接到站内条目（/servers/xxx）会出现在文章页的“文中提到的服务”', edit: (t, s, e) => wrap('[', '](https://)', '链接文字')(t, s, e) },
  { icon: Quotes, title: '引用', edit: prefixLines(() => '> '), gap: true },
  { icon: ListBullets, title: '无序列表', edit: prefixLines(() => '- ') },
  { icon: ListNumbers, title: '有序列表', edit: prefixLines((i) => `${i + 1}. `) },
  { icon: CodeBlock, title: '代码块', edit: block('```bash\n\n```', 8, 0), gap: true },
  { icon: Table, title: '表格', edit: block('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |', 2, 3) },
  { icon: Info, title: '提示块（> [!TIP]）', edit: block('> [!TIP]\n> 提示内容', 11, 4) },
]

/* ========== 页面 ========== */

export function BlogEditorPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const { user } = useShell()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [form, setForm] = useState<Form>(() => emptyForm(localStorage.getItem(AUTHOR_KEY) || user.username))
  const [saved, setSaved] = useState<string>(() => JSON.stringify(form))
  const [loadError, setLoadError] = useState<Error>()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('split')
  const { data: ai } = useApi<AiOptions>('/blog/ai/options')
  const [dialog, setDialog] = useState<'body' | 'all' | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const aiAbort = useRef<AbortController | null>(null)
  const generating = progress?.done === null
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** 已经在编辑的文章 id：新建保存后地址换成 /blog/<id>，不需要再加载一次（也免得冲掉刚输入的内容） */
  const loaded = useRef<number | null>(null)
  const dirty = JSON.stringify(form) !== saved

  useEffect(() => {
    if (isNew || loaded.current === Number(id)) return
    api<BlogPost>(`/blog/posts/${id}`).then(
      (p) => {
        loaded.current = p.id
        setPost(p)
        const f = formOf(p)
        setForm(f)
        setSaved(JSON.stringify(f))
      },
      (e: Error) => setLoadError(e),
    )
  }, [id, isNew])

  // 有没保存的修改时，关闭或刷新页面前提醒
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // 有译文在排队或翻译时，每 5 秒刷新翻译状态（只更新状态，不动正在编辑的表单）
  const translating = post?.translations.some((t) => t.state?.status === 'pending' || t.state?.status === 'running')
  useEffect(() => {
    if (!translating || !post) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      api<BlogPost>(`/blog/posts/${post.id}`).then(
        (p) => setPost((cur) => (cur && cur.id === p.id ? { ...cur, translations: p.translations, translationEnabled: p.translationEnabled } : cur)),
        () => {},
      )
    }, 5_000)
    return () => clearInterval(timer)
  }, [translating, post?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const retranslate = async (locale: TranslateLocale) => {
    if (!post) return
    setBusy(`translate-${locale}`)
    try {
      const p = await api<BlogPost>(`/blog/posts/${post.id}/translate`, { method: 'POST', body: { locales: [locale], force: true } })
      setPost((cur) => (cur ? { ...cur, translations: p.translations } : cur))
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  const save = useCallback(
    async (status: BlogInput['status'] = form.status) => {
      setBusy(status === form.status ? 'save' : status)
      setMsg(null)
      try {
        const body = payload(form, status)
        // 按已保存的文章 id 决定新建还是更新：新建后路由参数可能还没切到新地址
        const target = post?.id
        const p = target ? await api<BlogPost>(`/blog/posts/${target}`, { method: 'PUT', body }) : await api<BlogPost>('/blog/posts', { method: 'POST', body })
        loaded.current = p.id
        localStorage.setItem(AUTHOR_KEY, p.authorName)
        const f = formOf(p)
        setPost(p)
        setForm(f)
        setSaved(JSON.stringify(f))
        setMsg({ ok: true, text: status === 'published' ? (new Date(p.publishedAt!) > new Date() ? `已保存，将于 ${dateTime(p.publishedAt)} 发布` : '已发布，约半分钟后网站可见') : '草稿已保存' })
        if (!target) navigate(`/blog/${p.id}`, { replace: true })
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message })
      } finally {
        setBusy(null)
      }
    },
    [form, post, navigate],
  )

  const remove = async () => {
    if (!post || !confirm(`删除《${post.title}》？删除后不能恢复。`)) return
    setBusy('delete')
    try {
      await api(`/blog/posts/${post.id}`, { method: 'DELETE' })
      setSaved(JSON.stringify(form))
      navigate('/blog', { replace: true })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      setBusy(null)
    }
  }

  /** 对正文选区做一次编辑，保留撤销记录（execCommand 插入的文字可以 ⌘Z） */
  const apply = (edit: Edit) => {
    const el = textarea.current
    if (!el) return
    const { text, start, end } = edit(el.value, el.selectionStart, el.selectionEnd)
    el.focus()
    el.select()
    if (!document.execCommand('insertText', false, text)) set('body', text)
    el.setSelectionRange(start, end)
  }

  const insertImages = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (!images.length) return
    setBusy('upload')
    setMsg(null)
    try {
      for (const file of images) {
        const url = await uploadImage(file)
        const alt = file.name.replace(/\.[^.]+$/, '').replace(/^image$/, '')
        apply(block(`![${alt}](${url})`))
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const uploadCover = async (file: File | undefined) => {
    if (!file) return
    setBusy('cover')
    try {
      set('coverUrl', await uploadImage(file))
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  // ⌘S 保存；⌘B / ⌘I / ⌘K 在正文里加粗、斜体、链接
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 's') {
        e.preventDefault()
        if (!busy) void save()
      } else if (document.activeElement === textarea.current && ['b', 'i', 'k'].includes(e.key)) {
        e.preventDefault()
        apply(TOOLS[{ b: 2, i: 3, k: 5 }[e.key as 'b' | 'i' | 'k']]!.edit)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  /* ========== AI 生成 ========== */

  /** 跑一次流式生成：进度记进浮层，内容由 apply 回填到表单 */
  const runAi = async (label: string, path: string, body: unknown, applyEvent: (e: AiEvent) => void) => {
    const controller = new AbortController()
    aiAbort.current = controller
    setProgress(newProgress(label))
    setMsg(null)
    try {
      await aiStream(
        path,
        body,
        (e) => {
          if (e.type === 'ping') return
          setProgress((p) => (p ? track(p, e) : p))
          applyEvent(e)
        },
        controller.signal,
      )
      setProgress((p) => (p && p.done === null ? { ...p, done: true } : p))
    } catch (e) {
      const message = controller.signal.aborted ? '已停止' : (e as Error).message
      setProgress((p) => (p ? { ...p, done: false, error: message } : p))
    } finally {
      aiAbort.current = null
    }
  }

  /** 正文流式写入；插图生成好后把占位行换成真实图片 */
  const applyBody = (e: AiEvent) => {
    if (e.type === 'delta') setForm((f) => ({ ...f, body: f.body + e.text }))
    else if (e.type === 'image') setForm((f) => ({ ...f, body: e.markdown ? f.body.replace(e.line, e.markdown) : f.body.replace(`${e.line}\n`, '').replace(e.line, '') }))
    else if (e.type === 'body') setForm((f) => ({ ...f, body: e.body }))
  }

  const generateBody = (p: BodyParams) => {
    setDialog(null)
    if (form.body.trim() && !confirm('会替换现在的正文，继续？')) return
    setForm((f) => ({ ...f, body: '' }))
    setMode('split')
    void runAi('AI 写正文', '/body', { ...p, title: form.title }, applyBody)
  }

  const generateAll = (p: AllParams) => {
    setDialog(null)
    if ((form.title.trim() || form.body.trim()) && !confirm('会替换现在的标题、摘要、正文、地址、标签和封面，继续？')) return
    setForm((f) => ({ ...f, title: '', summary: '', body: '', ...(post ? {} : { slug: '' }), tags: '', coverUrl: p.cover === 'none' ? f.coverUrl : null }))
    setMode('split')
    void runAi('AI 一键生成', '/all', p, (e) => {
      // 已有文章（改过地址会让旧链接失效）不自动改地址
      if (e.type === 'meta') setForm((f) => ({ ...f, title: e.title, tags: e.tags.join(', '), ...(post && f.slug ? {} : { slug: e.slug }) }))
      else if (e.type === 'summary') setForm((f) => ({ ...f, summary: e.summary }))
      else if (e.type === 'cover') setForm((f) => ({ ...f, coverUrl: e.url }))
      else applyBody(e)
    })
  }

  const generateCover = (source: ImageSource) => {
    if (!form.title.trim()) return setMsg({ ok: false, text: '先填写标题再生成封面' })
    void runAi(source === 'ai' ? 'AI 生成封面' : '从图库找封面', '/cover', { title: form.title, summary: form.summary, source }, (e) => {
      if (e.type === 'cover') setForm((f) => ({ ...f, coverUrl: e.url }))
    })
  }

  const generateSummary = async () => {
    setBusy('summary')
    setMsg(null)
    try {
      const { summary } = await api<{ summary: string }>('/blog/ai/summary', { method: 'POST', body: { title: form.title, body: form.body } })
      set('summary', summary)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  // 生成正文时编辑区跟着滚到底部
  useEffect(() => {
    if (generating && textarea.current) textarea.current.scrollTop = textarea.current.scrollHeight
  }, [form.body, generating])

  const chars = useMemo(() => form.body.replace(/\s/g, '').length, [form.body])

  if (loadError) {
    return (
      <div className="p-8">
        <ErrorBox error={loadError} />
      </div>
    )
  }
  if (!isNew && !post) return <Loading />

  const published = post?.status === 'published'
  const scheduled = published && !!post.publishedAt && new Date(post.publishedAt) > new Date()
  const back = () => (!dirty || confirm('有没保存的修改，确定离开？')) && navigate('/blog')

  return (
    <>
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-4 border-b border-line bg-bg/90 px-8 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={back} className="rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink" title="返回文章列表">
            <ArrowLeft className="size-[18px]" />
          </button>
          <h1 className="text-lg font-semibold">{post ? '编辑文章' : '写文章'}</h1>
          {post && <span className={clsx('rounded-full px-2.5 py-0.5 text-xs', !published ? 'bg-white/5 text-text2' : scheduled ? 'bg-run/15 text-run' : 'bg-ok/10 text-ok')}>{!published ? '草稿' : scheduled ? '定时发布' : '已发布'}</span>}
          <span className={clsx('text-xs', msg ? (msg.ok ? 'text-ok' : 'text-err') : 'text-text3')}>{msg?.text ?? (dirty ? '有未保存的修改 · ⌘S 保存' : post ? `已保存 ${dateTime(post.updatedAt)}` : '')}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {post && published && !scheduled && (
            <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-text2 hover:bg-white/5 hover:text-ink">
              <ArrowSquareOut className="size-[15px]" />
              在网站查看
            </a>
          )}
          <Button icon={<MagicWand className="size-[15px] text-accent" />} onClick={() => setDialog('all')} disabled={!ai || generating}>
            AI 一键生成
          </Button>
          {post && <Button danger icon={<Trash className="size-[15px]" />} onClick={remove} disabled={!!busy || generating} />}
          {published ? (
            <>
              <Button onClick={() => save('draft')} disabled={!!busy}>
                {busy === 'draft' ? '处理中…' : '撤回为草稿'}
              </Button>
              <Button primary onClick={() => save('published')} disabled={!!busy || !dirty}>
                {busy === 'save' ? '保存中…' : '保存'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => save('draft')} disabled={!!busy || (!dirty && !!post)}>
                {busy === 'save' ? '保存中…' : '保存草稿'}
              </Button>
              <Button primary onClick={() => save('published')} disabled={!!busy}>
                {busy === 'published' ? '发布中…' : form.publishedAt && new Date(fromLocal(form.publishedAt)!) > new Date() ? '定时发布' : '发布'}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="flex gap-6 px-8 pb-10 pt-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="文章标题" className="bg-transparent text-[26px] font-bold tracking-tight outline-none placeholder:text-text3/60" />
          <div className="relative">
            <textarea
              value={form.summary}
              onChange={(e) => set('summary', e.target.value)}
              rows={2}
              maxLength={500}
              readOnly={generating}
              placeholder="摘要：显示在文章列表和搜索结果里，一两句话说清楚这篇讲什么"
              className="w-full resize-none rounded-lg border border-line bg-surface py-2.5 pl-3.5 pr-24 text-sm leading-relaxed outline-none placeholder:text-text3 focus:border-text3"
            />
            <button
              type="button"
              onClick={generateSummary}
              disabled={!ai?.text || generating || !!busy || form.body.trim().length < 50}
              title={!ai?.text ? '先在「AI 设置」里配置文本模型' : form.body.trim().length < 50 ? '正文写一些内容后才能生成摘要' : '根据标题和正文生成摘要'}
              className="absolute bottom-2.5 right-2.5 flex h-7 items-center gap-1 rounded-md border border-line bg-bg px-2 text-xs text-text2 hover:border-accent/50 hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-text2"
            >
              {busy === 'summary' ? <CircleNotch className="size-3.5 animate-spin" /> : <MagicWand className="size-3.5" />}
              AI 生成
            </button>
          </div>

          <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line px-2.5 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-0.5">
                {TOOLS.map(({ icon: Icon, title, edit, gap }) => (
                  <span key={title} className="flex items-center">
                    {gap && <span className="mx-1.5 h-4 w-px bg-line" />}
                    <button type="button" title={title} onClick={() => apply(edit)} disabled={mode === 'preview'} className="rounded-md p-1.5 text-text2 hover:bg-white/5 hover:text-ink disabled:opacity-30">
                      <Icon className="size-[17px]" />
                    </button>
                  </span>
                ))}
                <span className="mx-1.5 h-4 w-px bg-line" />
                <label title="插入图片（也可以直接粘贴或拖进正文）" className={clsx('cursor-pointer rounded-md p-1.5 text-text2 hover:bg-white/5 hover:text-ink', mode === 'preview' && 'pointer-events-none opacity-30')}>
                  {busy === 'upload' ? <CircleNotch className="size-[17px] animate-spin" /> : <ImageSquare className="size-[17px]" />}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden onChange={(e) => {
                    void insertImages([...(e.target.files ?? [])])
                    e.target.value = ''
                  }} />
                </label>
                <span className="mx-1.5 h-4 w-px bg-line" />
                <button type="button" onClick={() => setDialog('body')} disabled={!ai || generating} className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-accent hover:bg-accent/10 disabled:opacity-40">
                  <MagicWand className="size-3.5" />
                  AI 写正文
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden whitespace-nowrap font-mono text-[11px] text-text3 2xl:inline">{chars.toLocaleString('en-US')} 字</span>
                <div className="flex gap-0.5 rounded-lg bg-subtle p-0.5">
                  {(
                    [
                      ['edit', PencilSimple, '编辑'],
                      ['split', Columns, '分栏'],
                      ['preview', Eye, '预览'],
                    ] as const
                  ).map(([m, Icon, label]) => (
                    <button key={m} onClick={() => setMode(m)} title={label} className={clsx('flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs', mode === m ? 'bg-white/10 font-medium text-ink' : 'text-text3 hover:text-ink')}>
                      <Icon className="size-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex h-[calc(100vh-150px)] min-h-[520px]">
              <textarea
                ref={textarea}
                readOnly={generating}
                value={form.body}
                onChange={(e) => set('body', e.target.value)}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files]
                  if (files.some((f) => f.type.startsWith('image/'))) {
                    e.preventDefault()
                    void insertImages(files)
                  }
                }}
                onDrop={(e) => {
                  const files = [...e.dataTransfer.files]
                  if (files.length) {
                    e.preventDefault()
                    void insertImages(files)
                  }
                }}
                spellCheck={false}
                placeholder={'用 Markdown 写正文。\n\n## 二级标题会出现在文章目录里\n\n粘贴或拖入图片会自动上传；链接到站内条目（例如 [Linear](/servers/linear)）会出现在“文中提到的服务”。'}
                className={clsx('h-full resize-none bg-transparent p-5 font-mono text-[13.5px] leading-[1.75] outline-none placeholder:text-text3/70', mode === 'preview' ? 'hidden' : mode === 'split' ? 'w-1/2 border-r border-line' : 'w-full')}
              />
              {mode !== 'edit' && (
                <div className={clsx('h-full overflow-y-auto px-8 py-6', mode === 'split' ? 'w-1/2' : 'mx-auto w-full max-w-[860px]')}>
                  <MarkdownPreview source={form.body} />
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col gap-4">
          <Panel title="发布设置">
            <Field label="地址" hint="只能用小写字母、数字和连字符；发布后再改会让旧链接失效">
              <div className="flex h-9 items-center rounded-lg border border-line bg-bg pl-3 focus-within:border-text3">
                <span className="font-mono text-xs text-text3">/blog/</span>
                <input value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="remote-mcp-guide" className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono text-[13px] outline-none placeholder:text-text3/60" />
              </div>
            </Field>
            <Field label="标签" hint="逗号分隔，最多 8 个，自动转小写">
              <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="claude-code, remote, oauth" className={clsx(input, 'font-mono')} />
            </Field>
            <Field label="作者">
              <input value={form.authorName} onChange={(e) => set('authorName', e.target.value)} className={input} />
            </Field>
            <Field label="发布时间（北京时间）" hint={published ? '改到未来的时间会变成定时发布' : '不填则在点“发布”时取当前时间；填未来时间即定时发布'}>
              <input type="datetime-local" value={form.publishedAt} onChange={(e) => set('publishedAt', e.target.value)} className={clsx(input, 'font-mono [color-scheme:dark]')} />
            </Field>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line bg-bg px-3 py-2.5">
              <span>
                <span className="block text-[13px]">置顶</span>
                <span className="block text-[11px] text-text3">在博客首页第一位大图展示，只显示最新一篇置顶</span>
              </span>
              <input type="checkbox" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} className="size-4 accent-[var(--mf-accent)]" />
            </label>
          </Panel>

          <Panel title="封面">
            {form.coverUrl ? (
              <div className="relative overflow-hidden rounded-lg border border-line">
                <img src={form.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" />
                <button onClick={() => set('coverUrl', null)} className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80">
                  移除
                </button>
              </div>
            ) : (
              <label className="flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-xs text-text3 hover:border-text3 hover:text-text2">
                {busy === 'cover' ? <CircleNotch className="size-5 animate-spin" /> : <UploadSimple className="size-5" />}
                上传封面（16:9）
                <span className="text-[11px]">不传时显示默认封面</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/avif" hidden onChange={(e) => {
                    void uploadCover(e.target.files?.[0])
                    e.target.value = ''
                  }} />
              </label>
            )}
            <input value={form.coverUrl ?? ''} onChange={(e) => set('coverUrl', e.target.value || null)} placeholder="或填图片地址 https://…" className={clsx(input, 'font-mono text-xs')} />
            <div className="flex gap-2">
              <Button className="flex-1" icon={<MagicWand className="size-[15px] text-accent" />} onClick={() => generateCover('ai')} disabled={!ai?.image || !ai.text || generating} >
                AI 生成封面
              </Button>
              <Button onClick={() => generateCover('stock')} disabled={!ai?.stock || !ai.text || generating}>
                图库
              </Button>
            </div>
            {ai && (!ai.image || !ai.text) && <p className="text-[11px] leading-snug text-text3">AI 生成封面需要先在「AI 设置」里配置文本模型和生图模型</p>}
          </Panel>

          {post && (
            <Panel title="多语言译文" sub={published ? '发布和修改后自动翻译，翻完前网站显示中文或旧译文' : '发布后自动翻译成英文和日文'}>
              {!post.translationEnabled && <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-warn">服务器没有配置翻译模型，译文只会排队，不会翻译。</p>}
              <ul className="flex flex-col gap-2.5">
                {post.translations.map(({ locale, url, state }) => (
                  <li key={locale} className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-[13px]">
                        <span className="font-mono text-[11px] font-semibold text-text3">{locale.toUpperCase()}</span>
                        {LOCALE_LABEL[locale]}
                      </span>
                      <TranslationPill state={state} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-text3">
                      <span className="min-w-0 truncate">
                        {state?.status === 'failed' || (state?.status === 'pending' && state.nextAttemptAt)
                          ? `第 ${state.attempts} 次失败${state.nextAttemptAt ? `，${dateTime(state.nextAttemptAt)} 重试` : ''}`
                          : state?.translatedAt
                            ? `${dateTime(state.translatedAt)}${state.model ? ` · ${state.model}` : ''}`
                            : published
                              ? '等待翻译'
                              : '—'}
                      </span>
                      <span className="flex shrink-0 items-center gap-2.5">
                        {state?.hasContent && published && !scheduled && (
                          <a href={url} target="_blank" rel="noreferrer" className="hover:text-ink">
                            查看
                          </a>
                        )}
                        {published && (
                          <button onClick={() => retranslate(locale)} disabled={!!busy || state?.status === 'running'} className="hover:text-ink disabled:opacity-40">
                            {busy === `translate-${locale}` ? '…' : state ? '重新翻译' : '翻译'}
                          </button>
                        )}
                      </span>
                    </div>
                    {state?.error && (state.status === 'failed' || state.nextAttemptAt) && <p className="break-all text-[11px] leading-snug text-err/80">{state.error}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {post && (
            <Panel title="文中提到的服务" sub="保存时按正文里的站内链接更新">
              {post.mentions.length ? (
                <ul className="flex flex-col gap-2">
                  {post.mentions.map((m) => (
                    <li key={`${m.kind}/${m.slug}`} className="flex items-center gap-2.5 text-[13px]">
                      {m.iconUrl ? <img src={m.iconUrl} alt="" className="size-7 rounded-md bg-white/5 object-contain" /> : <span className="flex size-7 items-center justify-center rounded-md bg-white/5 text-[11px] text-text2">{m.name.slice(0, 2)}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.name}</span>
                        <span className="block text-[11px] text-text3">
                          {KIND_LABEL[m.kind as Kind] ?? m.kind}
                          {m.popularity ? ` · ${compact(m.popularity)}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-relaxed text-text3">正文里没有链接到站内条目。写成 [名称](/servers/slug) 这样的链接，文章页右侧会列出这些服务。</p>
              )}
            </Panel>
          )}

          {post && (
            <dl className="grid grid-cols-[72px_1fr] gap-y-1.5 px-1 text-xs">
              <dt className="text-text3">浏览</dt>
              <dd className="font-mono">{post.views.toLocaleString('en-US')}</dd>
              <dt className="text-text3">阅读时长</dt>
              <dd>约 {post.readingMinutes} 分钟</dd>
              <dt className="text-text3">创建于</dt>
              <dd className="font-mono">{dateTime(post.createdAt)}</dd>
            </dl>
          )}
        </aside>
      </div>
      {dialog === 'body' && ai && <BodyDialog options={ai} title={form.title} onClose={() => setDialog(null)} onStart={generateBody} />}
      {dialog === 'all' && ai && <AllDialog options={ai} onClose={() => setDialog(null)} onStart={generateAll} />}
      {progress && <ProgressPanel progress={progress} onStop={() => aiAbort.current?.abort()} onClose={() => setProgress(null)} />}
    </>
  )
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-xl border border-line bg-surface p-4">
      <header>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-[11px] text-text3">{sub}</p>}
      </header>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-text2">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-text3">{hint}</span>}
    </label>
  )
}
