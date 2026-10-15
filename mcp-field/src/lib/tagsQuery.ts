import { ROUTE, type Kind } from './api/entities'

/*
 * 标签页的 URL 参数：服务端 loader 和页面组件共用同一套解析规则，不合法的取值一律忽略。
 */

export const TAG_PAGE_SIZE = 300
export const TAG_KINDS = Object.keys(ROUTE) as Kind[]
/** 首字母索引：0-9 在前，a–z；other（中文等）只在有标签时显示 */
export const LETTERS = ['0-9', ...'abcdefghijklmnopqrstuvwxyz', 'other']

export type TagSort = 'count' | 'name'
export type TagsQuery = { kind: Kind | null; q: string; letter: string | null; sort: TagSort; page: number }

export function parseTagsQuery(sp: URLSearchParams): TagsQuery {
  const rawKind = sp.get('kind') as Kind | null
  const kind = rawKind && TAG_KINDS.includes(rawKind) ? rawKind : null
  const rawLetter = sp.get('letter')
  const letter = rawLetter && LETTERS.includes(rawLetter) ? rawLetter : null
  const sort: TagSort = sp.get('sort') === 'name' ? 'name' : 'count'
  const q = (sp.get('q') ?? '').trim().toLowerCase()
  const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
  return { kind, q, letter, sort, page }
}

/** 规范化后的查询串：参数顺序固定，省略默认值；用于链接和 canonical */
export function tagsSearch(q: Partial<TagsQuery>): string {
  const sp = new URLSearchParams()
  if (q.kind) sp.set('kind', q.kind)
  if (q.letter) sp.set('letter', q.letter)
  if (q.q) sp.set('q', q.q)
  if (q.sort && q.sort !== 'count') sp.set('sort', q.sort)
  if (q.page && q.page > 1) sp.set('page', String(q.page))
  return sp.toString()
}

/** 标签链接：带这个标签的条目的目录页 */
export const tagPath = (kind: Kind, tag: string) => `/${ROUTE[kind]}?tag=${encodeURIComponent(tag)}`
