import { LOCALES, type EntityKind, type Locale } from '../core/types.ts'
import { sha256 } from '../store/hash.ts'

/** 一个发布条目生成搜索行要用的原料 */
export interface SearchSource {
  slug: string
  name: string | null
  /** 英文简介：tagline，没有时 description */
  tagline: string | null
  /** 该类型 sort=popular 的热度；没有时为 null */
  popularity: number | null
  featured: boolean
  /** 简介译文：语言 → 译文 */
  translations: Partial<Record<Locale, string>>
  /** 我们自己撰写的简介（各语言） */
  generated: string[]
}

/** ingest_search 的一行 */
export interface SearchRow {
  kind: EntityKind
  locale: Locale
  popRank: number
  featuredRank: number
  slug: string
  body: string
  rowHash: string
}

/** 没有热度指标的排在最后（与列表 sort=popular 的 popularity IS NULL 排最后一致） */
export const NO_POPULARITY = Number.MAX_SAFE_INTEGER

/**
 * 一个条目在每种语言下的搜索行。body 收录的文字与原来列表接口的搜索条件一致：名称、slug、英文简介、
 * 这种语言的简介译文、自撰简介（不分语言）。去掉重复的片段（英文"译文"常常就是原文），用换行分隔，
 * 关键词不会跨字段拼出原本不存在的词。
 */
export function searchRows(kind: EntityKind, src: SearchSource): SearchRow[] {
  const popRank = src.popularity === null ? NO_POPULARITY : -src.popularity
  const featuredRank = src.featured ? 0 : 1
  return LOCALES.map((locale) => {
    const parts = [src.name, src.slug, src.tagline, src.translations[locale], ...src.generated].filter((v): v is string => !!v)
    const body = [...new Set(parts)].join('\n')
    return { kind, locale, popRank, featuredRank, slug: src.slug, body, rowHash: sha256(`${popRank}|${featuredRank}|${body}`) }
  })
}
