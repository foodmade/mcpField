import { createHash } from 'node:crypto'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import { ENTITY_KINDS, type EntityKind } from '../core/types.ts'

/* 博客文章的取值约定和纯函数：后台接口保存时、网站接口读取时共用 */

/** 栏目：product 产品更新 / tutorial 上手教程 / ecosystem 生态观察 / testing 实测记录 / case 案例拆解 */
export const BLOG_CATEGORIES = ['product', 'tutorial', 'ecosystem', 'testing', 'case'] as const
export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export const BLOG_STATUSES = ['draft', 'published'] as const
export type BlogStatus = (typeof BLOG_STATUSES)[number]

/** 原文是中文，翻译成这些语言 */
export const BLOG_TRANSLATE_LOCALES = ['en', 'ja'] as const
export type BlogTranslateLocale = (typeof BLOG_TRANSLATE_LOCALES)[number]

export const BLOG_TRANSLATION_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export type BlogTranslationStatus = (typeof BLOG_TRANSLATION_STATUSES)[number]

/** 原文指纹：标题、摘要、正文任何一处变了都要重新翻译 */
export function blogSourceHash(post: { title: string; summary: string; body: string }): string {
  return createHash('sha256').update(`${post.title}\n\u0000${post.summary}\n\u0000${post.body.replace(/\r\n?/g, '\n')}`).digest('hex')
}

/** 地址里的 slug：小写字母、数字，用单个连字符连接 */
export const BLOG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 正文里链接到的站内条目：名称和图标是保存时的快照 */
export interface BlogMention {
  kind: EntityKind
  slug: string
  name: string
  iconUrl: string | null
  /** 星数 / 安装量 / 浏览量，没有时为空 */
  popularity: number | null
}

/** 中文按每分钟 400 字、英文按每分钟 200 词估算，代码块按一半速度算进去，至少 1 分钟 */
export function readingMinutes(markdown: string): number {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\]\([^)]*\)/g, ']')
  const cjk = text.match(/[぀-ヿ㐀-鿿가-힯]/g)?.length ?? 0
  const words = text.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').match(/[A-Za-z0-9][\w'-]*/g)?.length ?? 0
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}

const KIND_BY_ROUTE = new Map(ENTITY_KINDS.map((k) => [ROUTE_BY_KIND[k], k]))
// [文字](/servers/x)、[文字](https://mcpfield.com/en/skills/y?tab=z)；代码块里的不算
const LINK_RE = /\]\(\s*(?:https?:\/\/(?:www\.)?mcpfield\.com)?(?:\/(?:en|ja))?\/([a-z-]+)\/([^\s/?#)]+)/g

/** 按出现顺序取出正文里链接到的站内条目（去重，最多 max 个） */
export function extractMentionTargets(markdown: string, max = 8): { kind: EntityKind; slug: string }[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '')
  const seen = new Set<string>()
  const out: { kind: EntityKind; slug: string }[] = []
  for (const m of text.matchAll(LINK_RE)) {
    const kind = KIND_BY_ROUTE.get(m[1]!)
    if (!kind) continue
    let slug: string
    try {
      slug = decodeURIComponent(m[2]!)
    } catch {
      continue
    }
    const key = `${kind}/${slug}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, slug })
    if (out.length >= max) break
  }
  return out
}

/** 标签：去空白、转小写、去重，最多 8 个 */
export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 8)
}
