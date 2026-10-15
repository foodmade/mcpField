import type { Kind, PageMeta } from './entities'
import { apiGet } from './http'

/* 与后端 mcp-field-crawler/src/api/modules/tags 的返回结构保持一致 */

export type TagItem = {
  tag: string
  count: number
  /** 条目最多的类型：不限类型时，标签链接到这个类型的目录页 */
  kind: Kind
}

export type TagSummary = {
  /** 当前类型范围内的标签数（不受关键词、首字母影响，下同） */
  tags: number
  /** 出现 10 次及以上的标签数 */
  common: number
  /** 带标签的条目数 */
  entries: number
  /** 全部类型合计的标签数（不受类型筛选影响，同一标签只算一次） */
  all: number
  /** 各类型的标签数（不受类型筛选影响），没有标签的类型不列出 */
  kinds: Partial<Record<Kind, number>>
  /** 各首字母的标签数：a–z、0-9、other */
  letters: Record<string, number>
}

export type TagParams = {
  kind?: Kind
  q?: string
  /** a–z、0-9、other */
  letter?: string
  sort?: 'count' | 'name'
  page?: number
  pageSize?: number
}

export type TagList = { data: TagItem[]; meta: PageMeta; summary: TagSummary }

export const fetchTags = (params: TagParams, signal?: AbortSignal) => apiGet<TagList>('/tags', params, signal)
