import type { EntityDraft } from '../core/draft.ts'
import { sha256, stableJson } from '../store/hash.ts'
import type { OverviewInput } from './types.ts'

const MAX_README_CHARS = 12_000
/** README 太短时信息不足，不生成介绍，避免写出空洞内容 */
export const MIN_README_CHARS = 200
const MAX_CODE_LINES = 8

/**
 * 清理 README，只留下对写介绍有用的文字：
 * 去掉注释、徽章、图片、HTML 标签，链接只保留文字，长代码块只保留开头几行，最后按段落截断。
 */
export function prepareReadme(markdown: string, maxChars = MAX_README_CHARS): string {
  let s = markdown.replace(/\r\n?/g, '\n')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
    const lines = block.split('\n')
    return lines.length > MAX_CODE_LINES + 2 ? [...lines.slice(0, MAX_CODE_LINES + 1), '…', '```'].join('\n') : block
  })
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // 徽章 [![alt](img)](link)
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
  s = s.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1') // 链接只留文字
  s = s.replace(/<(img|source|br|hr)[^>]*>/gi, ' ')
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ') // 其余 HTML 标签
  s = s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  if (s.length <= maxChars) return s
  const cut = s.lastIndexOf('\n\n', maxChars)
  return s.slice(0, cut > maxChars * 0.6 ? cut : maxChars).trim() + '\n…'
}

/**
 * 输入指纹：README、名称、简介、标签、网站变了才重新生成。
 * 分类不算在内（仍会交给模型作参考）：分类器重跑会一次改掉大批条目的分类（2026-10 改了 1.4 万条），
 * 介绍内容基本取决于 README，为此全部重写不值得，每日任务也会因此从增量变成大批量
 */
export function overviewInputHash(kind: EntityDraft['kind'], f: Pick<OverviewInput, 'name' | 'tagline' | 'tags' | 'website' | 'readme'>): string {
  return sha256(stableJson({ kind, name: f.name, tagline: f.tagline, tags: f.tags, website: f.website, readme: f.readme }))
}

/** 从草稿和它的 GitHub README（见 readme/source.ts）构造生成介绍的输入；没有足够 README 内容时返回 null */
export function inputFromDraft(draft: EntityDraft, readmeRaw: string, stars: number | null): OverviewInput | null {
  const readme = prepareReadme(readmeRaw)
  if (readme.length < MIN_README_CHARS) return null
  const tagline = draft.texts.find((t) => t.field === 'tagline')?.content ?? null
  const category = draft.categories.find((c) => c.primary)?.slug ?? null
  const website = draft.links.find((l) => l.type === 'website')?.url ?? null
  const fields = { name: draft.name, tagline, category, tags: draft.tags, website, readme }
  return {
    sourceId: draft.sourceId,
    kind: draft.kind,
    externalId: draft.externalId,
    ...fields,
    stars,
    inputHash: overviewInputHash(draft.kind, fields),
  }
}
