import { z } from 'zod'

/*
 * skills.sh 官方 API 的数据结构（2026-10 实测，文档 https://skills.sh/docs/api）。
 * 一个 skill 的文档由 SkillsShFetcher 合成：{ listing: 排行榜条目, skill: 详情, audits: 安全审计 }。
 */

const str = z.string().nullish()

export const listingSchema = z.looseObject({
  /** owner/repo/skill（GitHub）或 domain/skill（well-known） */
  id: z.string(),
  slug: z.string(),
  name: str,
  /** owner/repo 或域名 */
  source: z.string(),
  installs: z.number().nullish(),
  /** github / well-known */
  sourceType: str,
  installUrl: str,
  url: str,
})

export const auditSchema = z.looseObject({
  provider: z.string(),
  slug: str,
  /** pass / fail / warn …… */
  status: str,
  summary: str,
  auditedAt: str,
  /** SAFE / LOW / MEDIUM / HIGH / CRITICAL …… */
  riskLevel: str,
  categories: z.array(z.string()).nullish(),
})

export const documentSchema = z.looseObject({
  listing: listingSchema,
  skill: z.looseObject({
    id: z.string(),
    source: z.string(),
    slug: z.string(),
    installs: z.number().nullish(),
    hash: str,
    files: z.array(z.looseObject({ path: z.string(), contents: str })).nullish(),
  }),
  audits: z.array(auditSchema).default([]),
})

export const listPageSchema = z.looseObject({
  data: z.array(z.unknown()),
  pagination: z.looseObject({ hasMore: z.boolean().nullish(), total: z.number().nullish() }).nullish(),
})

export type SkillsShListing = z.infer<typeof listingSchema>
export type SkillsShAudit = z.infer<typeof auditSchema>

/** 源记录：只保留 SKILL.md 正文和其余文件的路径（其他文件的内容不存，避免占用大量空间） */
export interface SkillsShRecord {
  listing: SkillsShListing
  installs: number | null
  /** skills.sh 给的内容哈希，SKILL.md 等文件变化时会变 */
  hash: string | null
  skillMd: string | null
  /** SKILL.md 以外的文件路径（references/、scripts/ ……） */
  files: string[]
  audits: SkillsShAudit[]
}
