import type { Context } from 'hono'
import { z } from 'zod'
import { ENTITY_KINDS } from '../../core/types.ts'
import { ApiError } from './errors.ts'

/** 用 zod 校验查询参数，失败时返回 400 并附上每个字段的错误 */
export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) {
    throw ApiError.badRequest(
      '查询参数不合法',
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    )
  }
  return result.data
}

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'))

/** 列表接口通用的分页、搜索、排序参数 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  /** mcp-field 分类 slug；none = 没有对应分类的条目 */
  category: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9-]+$/, '分类只能包含小写字母、数字和连字符')
    .optional(),
  featured: booleanFlag,
  verified: booleanFlag,
  official: booleanFlag,
  /** 只对 MCP 服务有效：true = 只要远程服务 */
  remote: booleanFlag,
  /** 条目子类型，只对有子类型的类型有效（Agent：product / template） */
  type: z
    .string()
    .trim()
    .max(32)
    .regex(/^[a-z0-9-]+$/, '类型只能包含小写字母、数字和连字符')
    .optional(),
  /** 标签（ingest_tags 里的规范化 slug，小写） */
  tag: z
    .string()
    .trim()
    .toLowerCase()
    .max(255)
    .optional()
    .transform((v) => v || undefined),
  /** popular = 按该类型的热度指标（服务/客户端/CLI 用星数，Skill 用安装量，Loop/Agent 用浏览量） */
  sort: z.enum(['popular', 'stars', 'installs', 'name', 'updated', 'newest']).default('popular'),
  /** 简介等文本的语言；没有译文时返回原文 */
  locale: z.enum(['zh', 'en', 'ja']).default('en'),
  /** false = 不统计总数（meta.total 为 null）：只要前几条时用，例如全站搜索 */
  withTotal: booleanFlag.transform((v) => v ?? true),
})

export type ListQuery = z.infer<typeof listQuerySchema>

export interface PageMeta {
  page: number
  pageSize: number
  /** 没有统计时（withTotal=false）为 null */
  total: number | null
  totalPages: number | null
}

export function pageMeta(query: Pick<ListQuery, 'page' | 'pageSize'>, total: number | null): PageMeta {
  return { page: query.page, pageSize: query.pageSize, total, totalPages: total === null ? null : Math.ceil(total / query.pageSize) }
}

/** 标签页：kind 不传 = 全部类型；letter 是首字母分组（a–z、0-9、other）；count = 按条目数排序 */
export const tagsQuerySchema = z.object({
  kind: z.enum(ENTITY_KINDS).optional(),
  q: listQuerySchema.shape.q,
  letter: z
    .string()
    .regex(/^([a-z]|0-9|other)$/, '首字母只能是 a–z、0-9 或 other')
    .optional(),
  sort: z.enum(['count', 'name']).default('count'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(300),
})

export type TagsQuery = z.infer<typeof tagsQuerySchema>

/** sitemap 分页：单个 sitemap 文件最多 5 万条 */
export const sitemapQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50_000).default(10_000),
})

export const localeQuerySchema = z.object({ locale: listQuerySchema.shape.locale })

/** 统计范围：侧栏计数要和列表用同一个范围（例如远程服务页只统计远程服务） */
export const scopeQuerySchema = z.object({ remote: booleanFlag })
export type Scope = Partial<z.infer<typeof scopeQuerySchema>>
