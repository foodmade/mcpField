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
