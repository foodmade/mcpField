import { sql } from 'drizzle-orm'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'

/*
 * AI 写文章的素材：按关键词在站内收录里找相关条目（搜索表 ingest_search 的中文行），
 * 把名称、简介、热度和站内地址交给模型，正文只引用真实存在的服务并链接到站内页面。
 * 「AI 选题」另取近期新增的热门条目（recentHotMaterials）作为候选。
 */

export interface Material {
  kind: EntityKind
  slug: string
  name: string
  /** 站内地址，如 /servers/github */
  path: string
  /** 星数 / 安装量 / 浏览量，没有时为空 */
  popularity: number | null
  description: string
  /** 源站的创建时间（ISO）：只有选题候选带 */
  addedAt?: string
}

/** 写文章常用的类型（Loop 太少，不搜） */
const KINDS: EntityKind[] = ['server', 'client', 'skill', 'cli', 'agent']
const PER_KIND = 3
const MAX_TERMS = 4
const MAX_ITEMS = 14

/** 太常见、搜了等于没搜的词 */
const STOP = new Set(['mcp', 'server', 'servers', 'cli', 'the', 'and', 'for', 'with', 'how', 'what', 'guide', 'tool', 'tools'])

const tokens = (text: string | undefined, separator: RegExp) =>
  (text ?? '')
    .split(separator)
    .map((t) => t.trim().replace(/\s+/g, ' ').replace(/^[#"'“”‘’（(]+|[#"'“”‘’）)]+$/g, '').toLowerCase())
    .filter((t) => (/[^\p{ASCII}]/u.test(t) ? t.length >= 2 : t.length >= 3) && !STOP.has(t))

/**
 * 搜索词：关键词按逗号、顿号、分号拆开（中英文都行），不按空格拆，“Codebase Memory”这类多词名称整体去搜；
 * 标题按空格拆，只取英文技术名（如 Claude、GitHub），中文标题切出来的是“里接入第一个远程”这类碎片，搜不到东西
 */
export function searchTerms(keywords: string | undefined, title?: string): string[] {
  const fromTitle = tokens(title, /[\s,，、;；/|]+/).filter((t) => /^[a-z0-9][a-z0-9.+-]*$/.test(t))
  return [...new Set([...tokens(keywords, /[,，、;；|\n]+/), ...fromTitle])].slice(0, MAX_TERMS)
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** 搜索表的 body 是“名称、slug、英文简介、中文简介、自撰简介”按行排列 */
function parseBody(body: string): { name: string; description: string } {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const name = lines[0] ?? ''
  const rest = lines.slice(2)
  // 优先用中文简介
  const zh = rest.find((l) => /[一-鿿]/.test(l))
  return { name, description: (zh ?? rest[0] ?? '').slice(0, 220) }
}

/**
 * 各搜索词的结果轮流取，凑够 max 条：前面的词（通常是主要条目的名称）至少排进去，
 * 不会被另一个词搜到的大量热门条目挤掉
 */
export function interleave<T>(groups: T[][], max: number): T[] {
  const out: T[] = []
  for (let i = 0; out.length < max && groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length && out.length < max) out.push(g[i]!)
  return out
}

type SearchRow = { kind: EntityKind; slug: string; body: string; popRank: number | string }

function toMaterial(r: SearchRow): Material {
  const { name, description } = parseBody(r.body)
  const rank = Number(r.popRank)
  // 没有热度指标的条目 pop_rank 是一个很大的数
  return { kind: r.kind, slug: r.slug, name, path: `/${ROUTE_BY_KIND[r.kind]}/${r.slug}`, popularity: rank < 0 ? -rank : null, description }
}

/**
 * 每个搜索词：先取名称完全一致的条目（列表键表的 sort_name 有索引），再按热度补模糊匹配的；
 * “REA”这类短名称模糊匹配会命中一大片含 create、real 的条目，名称一致的排在最前才不会被挤掉
 */
export async function searchMaterials(db: Db, terms: string[]): Promise<Material[]> {
  const seen = new Set<string>()
  const groups: Material[][] = []
  const kinds = sql.join(
    KINDS.map((k) => sql`${k}`),
    sql`, `,
  )
  for (const term of terms) {
    const [exact] = (await db.execute(
      sql`SELECT k.kind, k.slug, s.body, s.pop_rank AS popRank FROM ingest_list_keys k JOIN ingest_search s ON s.kind = k.kind AND s.locale = 'zh' AND s.slug = k.slug
          WHERE k.kind IN (${kinds}) AND k.sort_name = ${term} ORDER BY s.pop_rank LIMIT ${PER_KIND}`,
    )) as unknown as [SearchRow[]]
    const fuzzy: SearchRow[] = []
    for (const kind of KINDS) {
      // 按主键（类型 → 语言 → 热度）顺序扫描，凑够几条就停：热门的先出来
      const [rows] = (await db.execute(
        sql`SELECT slug, body, pop_rank AS popRank FROM ingest_search WHERE kind = ${kind} AND locale = 'zh' AND body LIKE ${likeOf(term)} ORDER BY pop_rank, featured_rank LIMIT ${PER_KIND}`,
      )) as unknown as [Omit<SearchRow, 'kind'>[]]
      fuzzy.push(...rows.map((r) => ({ ...r, kind })))
    }
    const group = [...exact, ...fuzzy.sort((a, b) => Number(a.popRank) - Number(b.popRank))]
      .filter((r) => !seen.has(`${r.kind}/${r.slug}`) && seen.add(`${r.kind}/${r.slug}`))
      .map(toMaterial)
    groups.push(group)
  }
  return interleave(groups, MAX_ITEMS)
}

/** 选题候选的类型：只有这几类有源站创建时间（Skill、CLI 的 source_created_at 是空的） */
const RECENT_KINDS: { kind: EntityKind; limit: number }[] = [
  { kind: 'server', limit: 30 },
  { kind: 'client', limit: 4 },
  { kind: 'agent', limit: 4 },
]

/**
 * 选题候选：近 days 天新增（按源站创建时间）的条目，每类按热度取前几个；exclude 里的（已经写过的）跳过。
 * 名称和简介取搜索表的中文行。
 */
export async function recentHotMaterials(db: Db, opts: { days: number; exclude?: Set<string> }): Promise<Material[]> {
  const since = new Date(Date.now() - opts.days * 86_400_000).toISOString()
  const out: Material[] = []
  // 同名的（同一个项目在不同来源收录了几份）只留热度最高的一个
  const names = new Set<string>()
  for (const { kind, limit } of RECENT_KINDS) {
    const [rows] = (await db.execute(
      sql`SELECT k.slug, k.popularity, k.source_created_at AS addedAt, s.body FROM ingest_list_keys k JOIN ingest_search s ON s.kind = k.kind AND s.locale = 'zh' AND s.slug = k.slug
          WHERE k.kind = ${kind} AND k.source_created_at >= ${since} ORDER BY k.popularity DESC LIMIT ${limit * 2 + (opts.exclude?.size ?? 0)}`,
    )) as unknown as [{ slug: string; popularity: number | string | null; addedAt: string; body: string }[]]
    let taken = 0
    for (const r of rows) {
      if (taken >= limit || opts.exclude?.has(`${kind}/${r.slug}`)) continue
      const { name, description } = parseBody(r.body)
      if (names.has(name.toLowerCase())) continue
      names.add(name.toLowerCase())
      taken++
      out.push({ kind, slug: r.slug, name, path: `/${ROUTE_BY_KIND[kind]}/${r.slug}`, popularity: r.popularity == null ? null : Number(r.popularity), description, addedAt: r.addedAt })
    }
  }
  return out
}

const KIND_LABEL: Record<EntityKind, string> = { server: 'MCP 服务', client: '客户端', cli: 'CLI', skill: 'Skill', loop: 'Loop', agent: 'Agent' }

/** 交给模型的素材清单 */
export function materialsText(items: Material[]): string {
  if (!items.length) return '（站内没有找到相关条目：不要编造具体的服务名、星数和链接）'
  return items.map((m) => `- ${m.name}（${KIND_LABEL[m.kind]}，站内地址 ${m.path}${m.popularity ? `，热度 ${m.popularity}` : ''}${m.addedAt ? `，新增于 ${m.addedAt.slice(0, 10)}` : ''}）：${m.description || '暂无简介'}`).join('\n')
}
