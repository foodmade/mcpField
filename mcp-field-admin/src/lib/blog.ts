import { ApiError } from './api'

/* 博客文章（mcp-field-crawler/src/admin-api/blog.ts） */

export type BlogStatus = 'draft' | 'published'

export interface BlogMention {
  kind: string
  slug: string
  name: string
  iconUrl: string | null
  popularity: number | null
}

export const TRANSLATE_LOCALES = ['en', 'ja'] as const
export type TranslateLocale = (typeof TRANSLATE_LOCALES)[number]
export const LOCALE_LABEL: Record<TranslateLocale, string> = { en: 'English', ja: '日本語' }

/** 一种语言的翻译状态（blog_post_translations 一行） */
export interface TranslationState {
  locale: TranslateLocale
  status: 'pending' | 'running' | 'done' | 'failed'
  /** 有译文，但对应的是旧版原文（新译文还没翻完） */
  outdated: boolean
  hasContent: boolean
  error: string | null
  attempts: number
  model: string | null
  translatedAt: string | null
  nextAttemptAt: string | null
}

export interface BlogRow {
  id: number
  slug: string
  title: string
  status: BlogStatus
  /** 已发布但发布时间还没到 */
  scheduled: boolean
  pinned: boolean
  views: number
  authorName: string
  publishedAt: string | null
  updatedAt: string
  url: string
  translations: TranslationState[]
}

export interface BlogPage {
  data: BlogRow[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
  counts: { all: number; draft: number; published: number; scheduled: number }
}

export interface BlogPost {
  id: number
  slug: string
  title: string
  summary: string
  body: string
  tags: string[]
  coverUrl: string | null
  authorName: string
  status: BlogStatus
  pinned: boolean
  mentions: BlogMention[]
  readingMinutes: number
  views: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  url: string
  /** 各语言的翻译状态和网站地址；state 为空 = 还没排过队（草稿不翻译） */
  translations: { locale: TranslateLocale; url: string; state: TranslationState | null }[]
  /** 服务器有没有配置翻译模型 */
  translationEnabled: boolean
}

/** 编辑表单：保存时整份提交 */
export type BlogInput = Pick<BlogPost, 'slug' | 'title' | 'summary' | 'body' | 'tags' | 'coverUrl' | 'authorName' | 'status' | 'pinned' | 'publishedAt'>

/** 上传图片，返回公开地址 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/admin/blog/uploads', { method: 'POST', body: form, credentials: 'same-origin' })
  const json = (await res.json().catch(() => ({}))) as { data?: { url: string }; error?: { code: string; message: string } }
  if (!res.ok || !json.data) throw new ApiError(res.status, json.error?.code ?? 'error', json.error?.message ?? `上传失败（${res.status}）`)
  return json.data.url
}

/** 翻译状态的文字和色调：idle 灰 / run 蓝 / ok 绿 / warn 黄 / err 红 */
export function translationLabel(state: TranslationState | null): { label: string; tone: 'idle' | 'run' | 'ok' | 'warn' | 'err' } {
  if (!state) return { label: '未翻译', tone: 'idle' }
  if (state.status === 'running') return { label: state.hasContent ? '更新中' : '翻译中', tone: 'run' }
  if (state.status === 'failed') return { label: '翻译失败', tone: 'err' }
  if (state.status === 'pending') return state.nextAttemptAt ? { label: '稍后重试', tone: 'warn' } : { label: state.hasContent ? '等待更新' : '排队中', tone: 'run' }
  return state.outdated ? { label: '译文较旧', tone: 'warn' } : { label: '已完成', tone: 'ok' }
}

/* ========== AI 生成（mcp-field-crawler/src/admin-api/blog-ai.ts、settings.ts） ========== */

export interface AiOptions {
  directions: { id: string; label: string; guide: string }[]
  /** 文本模型、生图、图库是否已配置 */
  text: boolean
  image: boolean
  stock: boolean
}

export type ImageSource = 'ai' | 'stock'

/** 流式生成的事件（一行一个 JSON） */
export type AiEvent =
  | { type: 'ping' }
  | { type: 'stage'; stage: 'materials' | 'plan' | 'body' | 'images' | 'summary' | 'cover'; message: string }
  | { type: 'materials'; items: { name: string; path: string }[] }
  | { type: 'meta'; title: string; slug: string; tags: string[]; outline: string[] }
  | { type: 'delta'; text: string }
  | { type: 'image'; line: string; markdown: string | null; error?: string }
  | { type: 'body'; body: string }
  | { type: 'summary'; summary: string }
  | { type: 'cover'; url: string }
  | { type: 'warning'; message: string }
  | { type: 'done'; failed: string[] }
  | { type: 'error'; message: string }

/** 调用流式生成接口，逐个事件回调；收到 error 事件时抛错 */
export async function aiStream(path: string, body: unknown, onEvent: (e: AiEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api/admin/blog/ai${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', signal })
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
    throw new ApiError(res.status, json.error?.code ?? 'error', json.error?.message ?? `请求失败（${res.status}）`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (!line) continue
      const event = JSON.parse(line) as AiEvent
      if (event.type === 'error') throw new Error(event.message)
      onEvent(event)
    }
  }
}

export interface AiEndpointView {
  baseURL: string
  model: string
  /** 掩码，如 sk-6…5e28 */
  apiKey: string
  hasKey: boolean
  ready: boolean
}

export interface AiSettings {
  text: AiEndpointView
  image: AiEndpointView & { size: string }
  stock: { apiKey: string; hasKey: boolean; ready: boolean }
}
