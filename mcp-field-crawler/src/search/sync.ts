import { sql, type SQL } from 'drizzle-orm'
import { POPULAR_METRIC } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import { LOCALES, type EntityKind, type Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { FEATURED, NAME, popularity, popularityNeedsRepo, REPO_STATS, TAGLINE } from '../db/published-sql.ts'
import { ingestSearch } from '../db/schema/index.ts'
import { sourceHash } from '../translate/key.ts'
import { searchRows, type SearchRow } from './rows.ts'

/*
 * 同步搜索表 ingest_search：按发布层、简介译文、自撰简介、GitHub 星数重新算出每个条目的搜索行，
 * 与表里的指纹比较，只删改有变化的行。publish / github / translate / describe 结束时自动执行，也可以单独运行 search-index。
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const BATCH = 2000
const WRITE_CHUNK = 1000
/** 同一时间只跑一个同步：每日任务和手动运行的命令可能重叠 */
const LOCK = 'ingest_search_sync'

export interface SearchIndexStats {
  kind: EntityKind
  entities: number
  added: number
  updated: number
  removed: number
  seconds: number
}

interface SourceRow {
  id: number
  slug: string
  source_id: string
  external_id: string
  name: string | null
  tagline: string | null
  popularity: number | string | null
  featured: number | string | null
}

async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  const [result] = (await tx.execute(query)) as unknown as [T[]]
  return result
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 我们自己撰写的简介：主条目来源 + 外部 ID → 各语言的简介 */
async function generatedTaglines(tx: Tx, kind: EntityKind): Promise<Map<string, string[]>> {
  const found = await rows<{ source_id: string; external_id: string; content: string }>(
    tx,
    sql`SELECT source_id, external_id, content FROM ingest_generated_texts WHERE kind = ${kind} AND field = 'tagline'`,
  )
  const out = new Map<string, string[]>()
  for (const g of found) {
    const key = `${g.source_id}|${g.external_id}`
    out.set(key, [...(out.get(key) ?? []), g.content])
  }
  return out
}

/** 简介译文：原文指纹 → 语言 → 译文 */
async function translationsOf(tx: Tx, hashes: string[]): Promise<Map<string, Partial<Record<Locale, string>>>> {
  const out = new Map<string, Partial<Record<Locale, string>>>()
  if (hashes.length === 0) return out
  const found = await rows<{ source_hash: string; locale: Locale; content: string }>(
    tx,
    sql`SELECT source_hash, locale, content FROM ingest_translations WHERE source_hash IN (${sql.join(hashes.map((h) => sql`${h}`), sql`, `)})`,
  )
  for (const t of found) {
    if (!(LOCALES as readonly string[]).includes(t.locale)) continue
    out.set(t.source_hash, { ...out.get(t.source_hash), [t.locale]: t.content })
  }
  return out
}

async function removeRows(tx: Tx, kind: EntityKind, keys: { locale: Locale; slug: string }[]): Promise<void> {
  for (const part of chunk(keys, WRITE_CHUNK)) {
    await tx.execute(sql`DELETE FROM ingest_search WHERE kind = ${kind} AND (locale, slug) IN (${sql.join(part.map((k) => sql`(${k.locale}, ${k.slug})`), sql`, `)})`)
  }
}

async function syncKind(db: Db, kind: EntityKind): Promise<SearchIndexStats> {
  const started = Date.now()
  const metric = POPULAR_METRIC[kind]
  // 一个类型一个事务：首次生成时网站要么看到完整的一类，要么一行也没有（接口此时退回直接查发布层）
  return db.transaction(async (tx) => {
    const [lock] = await rows<{ ok: number | null }>(tx, sql`SELECT GET_LOCK(${LOCK}, 600) AS ok`)
    if (Number(lock?.ok) !== 1) throw new Error('另一个搜索表同步一直没有结束（等了 10 分钟）')
    try {
      const existing = new Map(
        (await rows<{ locale: Locale; slug: string; row_hash: string }>(tx, sql`SELECT locale, slug, row_hash FROM ingest_search WHERE kind = ${kind}`)).map((r) => [`${r.locale}|${r.slug}`, r.row_hash]),
      )
      const generated = await generatedTaglines(tx, kind)
      const seen = new Set<string>()
      const stats: SearchIndexStats = { kind, entities: 0, added: 0, updated: 0, removed: 0, seconds: 0 }

      for (let after = 0; ; ) {
        const sources = await rows<SourceRow>(
          tx,
          sql`SELECT d.id, d.slug, d.source_id, d.external_id, ${NAME} AS name, ${TAGLINE} AS tagline, ${popularity(metric)} AS popularity, ${FEATURED} AS featured
            FROM ingest_published d ${popularityNeedsRepo(metric) ? REPO_STATS : sql``}
            WHERE d.kind = ${kind} AND d.id > ${after}
            ORDER BY d.id
            LIMIT ${BATCH}`,
        )
        if (sources.length === 0) break
        after = Number(sources.at(-1)!.id)
        const hashes = sources.map((s) => (s.tagline ? sourceHash(s.tagline) : null))
        const translations = await translationsOf(tx, [...new Set(hashes.filter((h): h is string => !!h))])

        const changed: SearchRow[] = []
        sources.forEach((s, i) => {
          const next = searchRows(kind, {
            slug: s.slug,
            name: s.name,
            tagline: s.tagline,
            popularity: s.popularity === null ? null : Number(s.popularity),
            featured: Number(s.featured) === 1,
            translations: (hashes[i] && translations.get(hashes[i])) || {},
            generated: generated.get(`${s.source_id}|${s.external_id}`) ?? [],
          })
          for (const row of next) {
            const key = `${row.locale}|${row.slug}`
            seen.add(key)
            const old = existing.get(key)
            if (old === row.rowHash) continue
            changed.push(row)
            if (old === undefined) stats.added++
            else stats.updated++
          }
        })
        // 排序键在主键里，变了只能删掉旧行再插入
        await removeRows(tx, kind, changed.filter((r) => existing.has(`${r.locale}|${r.slug}`)))
        for (const part of chunk(changed, WRITE_CHUNK)) await tx.insert(ingestSearch).values(part)
        stats.entities += sources.length
      }

      // 发布层里已经没有的条目
      const gone = [...existing.keys()].filter((k) => !seen.has(k)).map((k) => ({ locale: k.slice(0, k.indexOf('|')) as Locale, slug: k.slice(k.indexOf('|') + 1) }))
      await removeRows(tx, kind, gone)
      stats.removed = gone.length
      stats.seconds = Math.round((Date.now() - started) / 1000)
      return stats
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${LOCK})`)
    }
  })
}

export async function syncSearchIndex(db: Db, kinds: readonly EntityKind[], logger: Logger): Promise<SearchIndexStats[]> {
  const all: SearchIndexStats[] = []
  for (const kind of kinds) {
    const stats = await syncKind(db, kind)
    logger.info(stats, '搜索表已同步')
    all.push(stats)
  }
  return all
}
