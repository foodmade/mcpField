import type { Locale } from '../../i18n/locales'
import type { Kind, PageMeta } from './entities'
import { apiGet, apiSend } from './http'

/* 与后端 mcp-field-crawler/src/api/modules/blog 的返回结构保持一致 */

export type BlogCard = {
  slug: string
  title: string
  summary: string
  tags: string[]
  coverUrl: string | null
  authorName: string
  pinned: boolean
  views: number
  readingMinutes: number
  publishedAt: string
  updatedAt: string
  /** 标题、摘要实际用的语言：请求语言还没有译文时是 zh */
  locale: Locale
  /** 已有译文的语言（不含原文 zh） */
  translations: Locale[]
}

/** 正文里链接到的站内条目（保存文章时的快照） */
export type BlogMention = { kind: Kind; slug: string; name: string; iconUrl: string | null; popularity: number | null }

export type BlogPost = BlogCard & {
  /** Markdown 正文：请求语言的译文，没有时是中文原文 */
  body: string
  mentions: BlogMention[]
  /** 显示的是译文时：译文是不是对应旧版原文（原文改过、新译文还没翻完） */
  translation: { outdated: boolean; translatedAt: string | null } | null
  older: { slug: string; title: string } | null
  newer: { slug: string; title: string } | null
  related: BlogCard[]
}

export type BlogSummary = {
  total: number
  latestAt: string | null
  pinned: BlogCard | null
  popular: BlogCard[]
  tags: { tag: string; count: number }[]
  tagCount: number
}

export type BlogList = { data: BlogCard[]; meta: PageMeta; summary: BlogSummary }

export type BlogParams = { tag?: string; q?: string; page?: number; pageSize?: number; locale?: Locale }

export const fetchBlogList = (params: BlogParams, signal?: AbortSignal) => apiGet<BlogList>('/blog/posts', params, signal)
export const fetchBlogPost = (slug: string, locale: Locale, signal?: AbortSignal) => apiGet<{ data: BlogPost }>(`/blog/posts/${encodeURIComponent(slug)}`, { locale }, signal).then((r) => r.data)
export const fetchBlogAll = (signal?: AbortSignal, locale: Locale = 'zh') => apiGet<{ data: BlogCard[] }>('/blog/all', { locale }, signal).then((r) => r.data)
/** 浏览数 +1：只在浏览器里打开文章时发，失败不影响页面 */
export const sendBlogView = (slug: string) => apiSend('POST', `/blog/posts/${encodeURIComponent(slug)}/views`).catch(() => {})
