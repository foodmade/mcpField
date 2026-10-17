import { Binoculars, BookOpen, Flask, Sparkle, Stack, type Icon } from '@phosphor-icons/react'
import type { BlogCategory } from './api/blog'

/* 博客页面共用：栏目的颜色和图标、正文目录、日期显示 */

/** 栏目颜色用于色点和没有封面时的默认封面 */
export const CATEGORY_STYLE: Record<BlogCategory, { color: string; icon: Icon }> = {
  product: { color: '#3DDC97', icon: Sparkle },
  tutorial: { color: '#2B7FFF', icon: BookOpen },
  ecosystem: { color: '#A78BFA', icon: Binoculars },
  testing: { color: '#D9944A', icon: Flask },
  case: { color: '#F472B6', icon: Stack },
}

export const BLOG_PAGE_SIZE = 10

/** 标题的锚点：保留文字（含中文）和数字，其余换成连字符；重复的加序号 */
export function headingId(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  const n = seen.get(base) ?? 0
  seen.set(base, n + 1)
  return n ? `${base}-${n}` : base
}

export type TocItem = { id: string; text: string; level: 2 | 3 }

/**
 * 从 Markdown 原文取出二、三级标题做目录（# 一级标题在正文里也按二级显示）。
 * 去掉行内的链接地址、代码和强调符号，按出现顺序生成锚点，和 BlogMarkdown 渲染时的锚点一一对应。
 */
export function tableOfContents(markdown: string): TocItem[] {
  const seen = new Map<string, number>()
  const out: TocItem[] = []
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line)
    if (f) {
      fence = fence === null ? f[1]! : fence === f[1] ? null : fence
      continue
    }
    if (fence) continue
    const h = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!h) continue
    const text = h[2]!
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim()
    const level = h[1]!.length
    const id = headingId(text, seen)
    if (level <= 3) out.push({ id, text, level: level === 3 ? 3 : 2 })
  }
  return out
}

/** 2026-10-09（北京时间） */
export const blogDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
