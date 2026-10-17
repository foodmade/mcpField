import { sql } from 'drizzle-orm'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'

/*
 * AI 写文章的素材：按关键词在站内收录里找相关条目（搜索表 ingest_search 的中文行），
 * 把名称、简介、热度和站内地址交给模型，正文只引用真实存在的服务并链接到站内页面。
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
}

/** 写文章常用的类型（Loop 太少，不搜） */
const KINDS: EntityKind[] = ['server', 'client', 'skill', 'cli', 'agent']
const PER_KIND = 3
const MAX_TERMS = 4
const MAX_ITEMS = 14

/** 太常见、搜了等于没搜的词 */
const STOP = new Set(['mcp', 'server', 'servers', 'the', 'and', 'for', 'with', 'how', 'what', 'guide', 'tool', 'tools'])

const tokens = (text: string | undefined) =>
  (text ?? '')
    .split(/[\s,，、;；/|]+/)
    .map((t) => t.trim().replace(/^[#"'“”‘’（(]+|[#"'“”‘’）)]+$/g, '').toLowerCase())
    .filter((t) => (/[^\p{ASCII}]/u.test(t) ? t.length >= 2 : t.length >= 3) && !STOP.has(t))

/**
 * 搜索词：关键词按逗号、空白、顿号拆开（中英文都行）；标题里只取英文技术名（如 Claude、GitHub），
 * 中文标题按空格切出来的是“里接入第一个远程”这类碎片，搜不到东西
 */
export function searchTerms(keywords: string | undefined, title?: string): string[] {
  const fromTitle = tokens(title).filter((t) => /^[a-z0-9][a-z0-9.+-]*$/.test(t))
  return [...new Set([...tokens(keywords), ...fromTitle])].slice(0, MAX_TERMS)
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

export async function searchMaterials(db: Db, terms: string[]): Promise<Material[]> {
  const seen = new Set<string>()
  const out: Material[] = []
  for (const term of terms) {
    for (const kind of KINDS) {
      // 按主键（类型 → 语言 → 热度）顺序扫描，凑够几条就停：热门的先出来
      const [rows] = (await db.execute(
        sql`SELECT slug, body, pop_rank AS popRank FROM ingest_search WHERE kind = ${kind} AND locale = 'zh' AND body LIKE ${likeOf(term)} ORDER BY pop_rank, featured_rank LIMIT ${PER_KIND}`,
      )) as unknown as [{ slug: string; body: string; popRank: number | string }[]]
      for (const r of rows) {
        const key = `${kind}/${r.slug}`
        if (seen.has(key)) continue
        seen.add(key)
        const { name, description } = parseBody(r.body)
        const rank = Number(r.popRank)
        // 没有热度指标的条目 pop_rank 是一个很大的数
        out.push({ kind, slug: r.slug, name, path: `/${ROUTE_BY_KIND[kind]}/${r.slug}`, popularity: rank < 0 ? -rank : null, description })
      }
    }
  }
  return out.sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1)).slice(0, MAX_ITEMS)
}

const KIND_LABEL: Record<EntityKind, string> = { server: 'MCP 服务', client: '客户端', cli: 'CLI', skill: 'Skill', loop: 'Loop', agent: 'Agent' }

/** 交给模型的素材清单 */
export function materialsText(items: Material[]): string {
  if (!items.length) return '（站内没有找到相关条目：不要编造具体的服务名、星数和链接）'
  return items.map((m) => `- ${m.name}（${KIND_LABEL[m.kind]}，站内地址 ${m.path}${m.popularity ? `，热度 ${m.popularity}` : ''}）：${m.description || '暂无简介'}`).join('\n')
}
