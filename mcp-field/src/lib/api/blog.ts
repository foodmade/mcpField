import type { Kind, PageMeta } from './entities'
import { apiGet, apiSend } from './http'

/* 与后端 mcp-field-crawler/src/api/modules/blog 的返回结构保持一致 */

export const BLOG_CATEGORIES = ['product', 'tutorial', 'ecosystem', 'testing', 'case'] as const
export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export type BlogCard = {
  slug: string
  title: string
  summary: string
  category: BlogCategory
  tags: string[]
  coverUrl: string | null
  authorName: string
  pinned: boolean
  views: number
  readingMinutes: number
  publishedAt: string
  updatedAt: string
}

/** 正文里链接到的站内条目（保存文章时的快照） */
export type BlogMention = { kind: Kind; slug: string; name: string; iconUrl: string | null; popularity: number | null }

export type BlogPost = BlogCard & {
  /** Markdown 原文 */
  body: string
  mentions: BlogMention[]
  older: { slug: string; title: string } | null
  newer: { slug: string; title: string } | null
  related: BlogCard[]
}

export type BlogSummary = {
  total: number
  categories: Record<BlogCategory, number>
  latestAt: string | null
  pinned: BlogCard | null
  popular: BlogCard[]
  tags: { tag: string; count: number }[]
}

export type BlogList = { data: BlogCard[]; meta: PageMeta; summary: BlogSummary }

export type BlogParams = { category?: BlogCategory; tag?: string; q?: string; page?: number; pageSize?: number }

export const fetchBlogList = (params: BlogParams, signal?: AbortSignal) => apiGet<BlogList>('/blog/posts', params, signal)
export const fetchBlogPost = (slug: string, signal?: AbortSignal) => apiGet<{ data: BlogPost }>(`/blog/posts/${encodeURIComponent(slug)}`, {}, signal).then((r) => r.data)
export const fetchBlogAll = (signal?: AbortSignal) => apiGet<{ data: BlogCard[] }>('/blog/all', {}, signal).then((r) => r.data)
/** 浏览数 +1：只在浏览器里打开文章时发，失败不影响页面 */
export const sendBlogView = (slug: string) => apiSend('POST', `/blog/posts/${encodeURIComponent(slug)}/views`).catch(() => {})
