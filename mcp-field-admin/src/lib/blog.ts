import { ApiError } from './api'

/* 博客文章（mcp-field-crawler/src/admin-api/blog.ts） */

export const BLOG_CATEGORIES = ['product', 'tutorial', 'ecosystem', 'testing', 'case'] as const
export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<BlogCategory, string> = { product: '产品更新', tutorial: '上手教程', ecosystem: '生态观察', testing: '实测记录', case: '案例拆解' }

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
  category: BlogCategory
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
  category: BlogCategory
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
export type BlogInput = Pick<BlogPost, 'slug' | 'title' | 'summary' | 'body' | 'category' | 'tags' | 'coverUrl' | 'authorName' | 'status' | 'pinned' | 'publishedAt'>

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
