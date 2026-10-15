import type { EntityDraftOf } from '../../core/draft.ts'
import type { EntityKind } from '../../core/types.ts'
import type { ListQuery, Scope } from '../http/query.ts'

export interface EntityRow<K extends EntityKind> {
  draft: EntityDraftOf<K>
  fetchedAt: string
  mappedAt: string
}

export interface CategoryCount {
  /** mcp-field 分类；null = 源站分类在 mcp-field 中没有对应项 */
  slug: string | null
  sourceValue: string
  count: number
}

/** 子类型计数（Agent：product / template） */
export interface TypeCount {
  value: string
  count: number
}

/** sitemap 条目：slug 和页面内容最后变化的时间 */
export interface SitemapEntry {
  slug: string
  updatedAt: string | null
}

export interface ViewCounts {
  official: number
  featured: number
  verified: number
}

/**
 * 实体读取仓储（仓储模式）：业务层只依赖这个接口。
 * 现阶段由 DraftEntityRepository 从发布层 ingest_published 读取（各来源合并后的草稿）；正式目录表发布后换成读取 entities 等表的实现，
 * service 和路由不用改。
 */
export interface EntityReadRepository<K extends EntityKind> {
  /** 列表：返回的草稿不含 README 等大段文本；query.withTotal 为 false 时不统计总数（total 为 null） */
  list(query: ListQuery): Promise<{ rows: EntityRow<K>[]; total: number | null }>
  findBySlug(slug: string): Promise<EntityRow<K> | null>
  categoryCounts(scope?: Scope): Promise<CategoryCount[]>
  /** 官方、精选、已认证的数量 */
  viewCounts(scope?: Scope): Promise<ViewCounts>
  /** 各子类型的数量；没有子类型的类型返回空数组 */
  typeCounts(scope?: Scope): Promise<TypeCount[]>
  /** 按 slug 排序分页列出全部条目（生成 sitemap 用） */
  sitemap(offset: number, limit: number): Promise<{ rows: SitemapEntry[]; total: number }>
}
