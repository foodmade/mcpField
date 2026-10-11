/** 目录里的实体类型，与 mcp-field 的栏目一一对应 */
export const ENTITY_KINDS = ['server', 'client', 'cli', 'skill', 'loop', 'agent'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

export const LOCALES = ['zh', 'en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value)
}

/** 发现阶段产出：一个待抓取的目标 */
export interface CrawlTarget {
  sourceId: string
  kind: EntityKind
  url: string
  /** 源站内的唯一标识（mcp.so 用 slug） */
  externalId: string
  /** 站点地图里的 lastmod，用于增量抓取 */
  lastmod?: Date
  priority?: number
}

export interface FetchRequest {
  url: string
  headers?: Record<string, string>
  /** 条件请求：上次抓取得到的 ETag / Last-Modified */
  conditional?: { etag?: string; lastModified?: string }
}

/** 抓取阶段产出：一份原始文档 */
export interface RawDocument {
  requestedUrl: string
  /** 跟随重定向后的最终地址 */
  url: string
  status: number
  headers: Record<string, string>
  body: string
  fetchedAt: Date
  durationMs: number
  /** 304：内容自上次抓取后没有变化，body 为空 */
  notModified: boolean
}

/** 解析阶段产出：源站原生结构的数据，尚未归一化 */
export interface SourceRecord<T = unknown> {
  sourceId: string
  kind: EntityKind
  externalId: string
  url: string
  parserVersion: number
  fetchedAt: Date
  data: T
}
