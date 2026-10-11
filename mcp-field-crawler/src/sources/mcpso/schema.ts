import { z } from 'zod'
import type { EntityKind } from '../../core/types.ts'

/*
 * mcp.so 详情页加载数据的结构（2026-10 实测）。
 * 用宽松对象：只校验我们用到的字段，源站新增字段不会导致解析失败。
 * 注意：tags / transports / config / tools / screenshots / steps 等字段是"JSON 编码的字符串"。
 */

const str = z.string().nullish()
const num = z.number().nullish()
const bool = z.boolean().nullish()
const date = z.union([z.string(), z.date()]).nullish()

const listing = {
  slug: z.string(),
  name: z.string(),
  featured: bool,
  verified: bool,
  createdAt: date,
  updatedAt: date,
}

export const serverSchema = z.looseObject({
  ...listing,
  id: str,
  previousSlug: str,
  tagline: str,
  description: str,
  iconUrl: str,
  repoUrl: str,
  websiteUrl: str,
  docsUrl: str,
  authorName: str,
  authorUrl: str,
  categoryId: str,
  version: str,
  license: str,
  runtime: str,
  transports: str,
  isRemote: bool,
  authType: str,
  install: str,
  config: str,
  tools: str,
  tags: str,
  screenshots: str,
  viewCount: num,
  stars: num,
  lastCommitAt: date,
})

export const clientSchema = z.looseObject({
  ...listing,
  id: str,
  previousSlug: str,
  tagline: str,
  description: str,
  iconUrl: str,
  repoUrl: str,
  websiteUrl: str,
  docsUrl: str,
  authorName: str,
  authorUrl: str,
  category: str,
  license: str,
  runtime: str,
  screenshots: str,
  tags: str,
  stars: num,
  viewCount: num,
  lastCommitAt: date,
})

export const cliSchema = z.looseObject({
  ...listing,
  command: str,
  owner: str,
  repository: str,
  homepage: str,
  install: str,
  category: str,
  kind: str,
  official: bool,
  agentReady: bool,
  aliases: z.array(z.string()).nullish(),
  examples: z.array(z.string()).nullish(),
  sources: z.array(z.looseObject({ name: str, url: str })).nullish(),
  lastVerifiedAt: str,
})

export const skillSchema = z.looseObject({
  ...listing,
  canonicalKey: str,
  owner: str,
  repository: str,
  skillSlug: str,
  description: str,
  category: str,
  topics: z.array(z.string()).nullish(),
  installCommand: str,
  repositoryUrl: str,
  sourceUrl: str,
  installs: num,
  stars: num,
  official: bool,
  firstSeen: str,
  securityAudits: z.array(z.string()).nullish(),
  sources: z.array(z.looseObject({ name: str, url: str })).nullish(),
})

export const loopSchema = z.looseObject({
  ...listing,
  id: str,
  category: str,
  type: str,
  maxIterations: num,
  checkCommand: str,
  supportedAgents: str,
  viewCount: num,
})

export const agentSchema = z.looseObject({
  ...listing,
  id: str,
  type: str,
  authorName: str,
  websiteUrl: str,
  repositoryUrl: str,
  iconUrl: str,
  tags: str,
  categories: str,
  screenshots: str,
})

export const SCHEMA_BY_KIND = {
  server: serverSchema,
  client: clientSchema,
  cli: cliSchema,
  skill: skillSchema,
  loop: loopSchema,
  agent: agentSchema,
} satisfies Record<EntityKind, z.ZodType>

/** 每种类型在路由加载数据里的键名 */
export const LOADER_KEY: Record<EntityKind, string> = {
  server: 'server',
  client: 'client',
  cli: 'tool',
  skill: 'skill',
  loop: 'loop',
  agent: 'entry',
}

export type McpSoItem<K extends EntityKind> = z.infer<(typeof SCHEMA_BY_KIND)[K]>

/** 一条 mcp.so 源记录：条目本身 + 页面级上下文（分类名、可链接标签等） */
export interface McpSoData<K extends EntityKind = EntityKind> {
  item: McpSoItem<K>
  context: { categoryName?: string; categorySlug?: string; linkableTags?: string[] }
}
