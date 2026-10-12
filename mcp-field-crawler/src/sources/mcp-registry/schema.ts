import { z } from 'zod'

/*
 * 官方 MCP Registry 的 server.json（schema 2025-12-11，2026-10 实测）。
 * 用宽松对象：只校验我们用到的字段，Registry 新增字段不会导致解析失败。
 * 列表接口和详情接口的每个条目都是 { server, _meta }。
 */

const str = z.string().nullish()
const bool = z.boolean().nullish()

/** 环境变量、请求头：只用名字、说明、是否必填、是否机密；取值一律不保存 */
const keyValue = z.looseObject({
  name: z.string(),
  description: str,
  isRequired: bool,
  isSecret: bool,
  default: z.unknown().optional(),
})

const pkg = z.looseObject({
  registryType: z.string(),
  identifier: z.string(),
  version: str,
  runtimeHint: str,
  transport: z.looseObject({ type: z.string() }).nullish(),
  environmentVariables: z.array(keyValue).nullish(),
})

const remote = z.looseObject({
  type: z.string(),
  url: z.string(),
  headers: z.array(keyValue).nullish(),
})

const icon = z.looseObject({
  src: z.string(),
  mimeType: str,
  sizes: z.array(z.string()).nullish(),
  theme: str,
})

export const serverSchema = z.looseObject({
  name: z.string(),
  description: str,
  title: str,
  version: str,
  websiteUrl: str,
  repository: z.looseObject({ url: str, source: str, subfolder: str }).nullish(),
  icons: z.array(icon).nullish(),
  packages: z.array(pkg).nullish(),
  remotes: z.array(remote).nullish(),
  /** 发布者自己提供的扩展信息（标签、关键词、分类……），结构不固定 */
  _meta: z.record(z.string(), z.unknown()).nullish(),
})

export const OFFICIAL_META = 'io.modelcontextprotocol.registry/official'
export const PUBLISHER_META = 'io.modelcontextprotocol.registry/publisher-provided'

const official = z.looseObject({
  /** active / deprecated / deleted */
  status: str,
  publishedAt: str,
  updatedAt: str,
  isLatest: bool,
})

export const entrySchema = z.looseObject({
  server: serverSchema,
  _meta: z.looseObject({ [OFFICIAL_META]: official.nullish() }).nullish(),
})

export const listSchema = z.looseObject({
  servers: z.array(z.unknown()),
  metadata: z.looseObject({ nextCursor: str, count: z.number().nullish() }).nullish(),
})

export type RegistryServer = z.infer<typeof serverSchema>
export type RegistryEntry = z.infer<typeof entrySchema>
