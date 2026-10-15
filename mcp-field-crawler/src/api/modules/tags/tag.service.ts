import { sql, type SQL } from 'drizzle-orm'
import { ENTITY_KINDS, type EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { pageMeta, type PageMeta, type TagsQuery } from '../../http/query.ts'
import { TtlCache } from '../../http/ttl-cache.ts'

/** 一个类型下的一个标签及其条目数 */
export interface TagCountRow {
  kind: EntityKind
  tag: string
  count: number
}

export interface TagCounts {
  rows: TagCountRow[]
  /** 各类型带标签的条目数 */
  entries: Partial<Record<EntityKind, number>>
}

export interface TagReader {
  read(): Promise<TagCounts>
}

export interface TagItem {
  tag: string
  count: number
  /** 条目最多的类型：不限类型时，标签链接到这个类型的目录页 */
  kind: EntityKind
}

export interface TagSummary {
  /** 当前类型范围内的标签数（不受关键词、首字母影响，下同） */
  tags: number
  /** 出现 COMMON_MIN 次及以上的标签数 */
  common: number
  /** 带标签的条目数 */
  entries: number
  /** 全部类型合计的标签数（不受类型筛选影响，同一标签只算一次） */
  all: number
  /** 各类型的标签数（不受类型筛选影响），没有标签的类型不列出 */
  kinds: Partial<Record<EntityKind, number>>
  /** 各首字母的标签数：a–z、0-9、other */
  letters: Record<string, number>
}

export interface TagList {
  data: TagItem[]
  meta: PageMeta
  summary: TagSummary
}

export const COMMON_MIN = 10

/** 标签的首字母分组：a–z、0-9，其余（中文等）归为 other */
export function letterOf(tag: string): string {
  const c = tag[0] ?? ''
  if (c >= 'a' && c <= 'z') return c
  if (c >= '0' && c <= '9') return '0-9'
  return 'other'
}

/** 从标签表 ingest_tags 汇总 */
export class PublishedTagReader implements TagReader {
  constructor(private readonly db: Db) {}

  private async rows<T>(query: SQL): Promise<T[]> {
    const [rows] = (await this.db.execute(query)) as unknown as [T[]]
    return rows
  }

  async read(): Promise<TagCounts> {
    const [rows, entries] = await Promise.all([
      this.rows<{ kind: EntityKind; tag: string; n: number | string }>(sql`SELECT kind, tag, COUNT(*) AS n FROM ingest_tags GROUP BY kind, tag`),
      this.rows<{ kind: EntityKind; n: number | string }>(sql`SELECT kind, COUNT(DISTINCT slug) AS n FROM ingest_tags GROUP BY kind`),
    ])
    return {
      rows: rows.map((r) => ({ kind: r.kind, tag: r.tag, count: Number(r.n) })),
      entries: Object.fromEntries(entries.map((r) => [r.kind, Number(r.n)])),
    }
  }
}

interface Scope {
  byCount: TagItem[]
  byName: TagItem[]
  entries: number
}

interface TagIndex {
  all: Scope
  kinds: Partial<Record<EntityKind, Scope>>
}

const byCount = (a: TagItem, b: TagItem) => b.count - a.count || (a.tag < b.tag ? -1 : 1)
const byName = (a: TagItem, b: TagItem) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
const scopeOf = (items: TagItem[], entries: number): Scope => ({ byCount: [...items].sort(byCount), byName: [...items].sort(byName), entries })

export function buildIndex({ rows, entries }: TagCounts): TagIndex {
  const merged = new Map<string, TagItem & { top: number }>()
  const perKind = new Map<EntityKind, TagItem[]>()
  for (const r of rows) {
    const list = perKind.get(r.kind) ?? []
    list.push({ tag: r.tag, count: r.count, kind: r.kind })
    perKind.set(r.kind, list)
    const m = merged.get(r.tag)
    if (!m) merged.set(r.tag, { tag: r.tag, count: r.count, kind: r.kind, top: r.count })
    else {
      m.count += r.count
      if (r.count > m.top) Object.assign(m, { kind: r.kind, top: r.count })
    }
  }
  const all = [...merged.values()].map(({ tag, count, kind }) => ({ tag, count, kind }))
  const total = Object.values(entries).reduce((s, n) => s + (n ?? 0), 0)
  const kinds: TagIndex['kinds'] = {}
  for (const kind of ENTITY_KINDS) {
    const list = perKind.get(kind)
    if (list) kinds[kind] = scopeOf(list, entries[kind] ?? 0)
  }
  return { all: scopeOf(all, total), kinds }
}

/** 标签数据每天随 publish 变一次，汇总结果缓存 10 分钟 */
const TTL_MS = 10 * 60_000

/** 标签页：全部标签按类型、关键词、首字母筛选，按条目数或名称排序后分页；筛选和分页在内存里做 */
export class TagService {
  private readonly cache: TtlCache<TagIndex>

  constructor(
    private readonly reader: TagReader,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(TTL_MS, 1, now)
  }

  async list(query: TagsQuery): Promise<TagList> {
    const index = await this.cache.get('all', async () => buildIndex(await this.reader.read()))
    const scope = query.kind ? index.kinds[query.kind] : index.all
    const items = scope ? (query.sort === 'name' ? scope.byName : scope.byCount) : []

    const letters: Record<string, number> = {}
    let common = 0
    for (const t of items) {
      const l = letterOf(t.tag)
      letters[l] = (letters[l] ?? 0) + 1
      if (t.count >= COMMON_MIN) common++
    }
    const kinds = Object.fromEntries(Object.entries(index.kinds).map(([k, s]) => [k, s.byCount.length]))

    const q = query.q?.toLowerCase()
    const filtered = q || query.letter ? items.filter((t) => (!q || t.tag.includes(q)) && (!query.letter || letterOf(t.tag) === query.letter)) : items
    const start = (query.page - 1) * query.pageSize
    return {
      data: filtered.slice(start, start + query.pageSize),
      meta: pageMeta(query, filtered.length),
      summary: { tags: items.length, common, entries: scope?.entries ?? 0, all: index.all.byCount.length, kinds, letters },
    }
  }
}
