import { sql } from 'drizzle-orm'
import { POPULAR_METRIC, SUBTYPE_PATH } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { FEATURED, LAST_COMMIT, metric, NAME, popularity, REPO_STATS, STARS, textAt } from '../db/published-sql.ts'

/*
 * 重建列表键表 ingest_list_keys 和 ingest_list_categories：把列表筛选、排序、侧栏计数要用的值从发布层草稿里一次算好。
 * 值来自发布层草稿和 GitHub 统计（星数、最近提交时间），publish / github / search-index 结束时执行；
 * 一类最多十万行，整类删掉重插比逐行比对简单。取值的 SQL 片段与直接查发布层时共用（db/published-sql.ts），两边结果一致。
 */

export interface ListKeyStats {
  kind: EntityKind
  rows: number
  /** 其中允许收录的（INDEXABLE） */
  indexable: number
  categories: number
  seconds: number
}

/** 同一时间只跑一个重建：每日任务和手动运行的命令可能重叠 */
const LOCK = 'ingest_list_keys_sync'

const bool = (path: string) => sql`(JSON_EXTRACT(d.draft, ${path}) = TRUE)`

/**
 * 详情页是否允许搜索引擎收录：内容太薄的页面加 noindex、不进 sitemap，免得大量相似的聚合页拉低整站质量评价。
 * 要有 AI 介绍（ingest_overviews，overview / describe 生成）；服务还要 ≥ 5 星，或者是官方、认证、精选、远程服务、已认领的；Skill 还要 ≥ 50 次安装。
 * 在重建后的 ingest_list_keys 上算（k 是本表，d 是对应的发布层条目）；AI 介绍在每日任务的 publish 之后才生成，新条目第二天重建时才会变成收录。
 * 标志位可能是 NULL，用 <=> 比较：NULL 参与 OR 会让整个结果变成 NULL（"未算过"），而不是 0。
 */
const INDEXABLE = sql`
  EXISTS (SELECT 1 FROM ingest_overviews o WHERE o.source_id = d.source_id AND o.kind = d.kind AND o.external_id = d.external_id)
  AND CASE k.kind
    WHEN 'server' THEN COALESCE(k.stars, 0) >= 5 OR k.official <=> 1 OR k.verified <=> 1 OR k.featured <=> 1 OR k.remote <=> 1
      OR EXISTS (SELECT 1 FROM entity_claims c WHERE c.kind = k.kind AND c.slug = k.slug AND c.revoked_at IS NULL)
    WHEN 'skill' THEN COALESCE(k.installs, 0) >= 50
    ELSE TRUE
  END`

async function syncKind(db: Db, kind: EntityKind): Promise<ListKeyStats> {
  const started = Date.now()
  const typePath = SUBTYPE_PATH[kind]
  const subtype = typePath ? sql`IF(JSON_TYPE(JSON_EXTRACT(d.draft, ${typePath})) = 'STRING', LEFT(JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${typePath})), 64), NULL)` : sql`NULL`
  // 一个类型一个事务，两张表一起换：重建期间网站读到的仍是旧数据
  return db.transaction(async (tx) => {
    const [[lock]] = (await tx.execute(sql`SELECT GET_LOCK(${LOCK}, 600) AS ok`)) as unknown as [{ ok: number | null }[]]
    if (Number(lock?.ok) !== 1) throw new Error('另一个列表键表重建一直没有结束（等了 10 分钟）')
    try {
      await tx.execute(sql`DELETE FROM ingest_list_keys WHERE kind = ${kind}`)
      await tx.execute(sql`DELETE FROM ingest_list_categories WHERE kind = ${kind}`)
      const [keys] = (await tx.execute(sql`
        INSERT INTO ingest_list_keys (kind, slug, remote, featured, verified, official, subtype, first_category, category_count, popularity, stars, installs, sort_name, last_commit_at, source_created_at)
        SELECT d.kind, d.slug, ${bool('$.detail.isRemote')}, ${FEATURED}, ${bool('$.flags.verified')}, ${bool('$.flags.official')}, ${subtype},
          LEFT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.categories[0].slug')), 'null'), 64),
          JSON_LENGTH(JSON_EXTRACT(d.draft, '$.categories')),
          ${popularity(POPULAR_METRIC[kind])}, ${STARS}, ${metric('skill_installs')},
          LOWER(LEFT(${NAME}, 255)), ${LAST_COMMIT}, ${textAt('$.sourceCreatedAt', 40)}
        FROM ingest_published d ${REPO_STATS}
        WHERE d.kind = ${kind}`)) as unknown as [{ affectedRows: number }]
      await tx.execute(sql`
        UPDATE ingest_list_keys k JOIN ingest_published d ON d.kind = k.kind AND d.slug = k.slug
        SET k.indexable = (${INDEXABLE})
        WHERE k.kind = ${kind}`)
      const [[indexable]] = (await tx.execute(sql`SELECT COUNT(*) AS n FROM ingest_list_keys WHERE kind = ${kind} AND indexable = 1`)) as unknown as [{ n: number | string }[]]
      // 源站分类没有对应项时 slug 为空（JSON null 取出来可能是字符串 'null'），存成空字符串
      const [categories] = (await tx.execute(sql`
        INSERT INTO ingest_list_categories (kind, slug, position, category, source_value, is_primary)
        SELECT d.kind, d.slug, c.position, COALESCE(NULLIF(c.slug, 'null'), ''), COALESCE(c.source_value, ''), COALESCE(c.is_primary = TRUE, FALSE)
        FROM ingest_published d,
             JSON_TABLE(d.draft, '$.categories[*]' COLUMNS (position FOR ORDINALITY, slug VARCHAR(64) PATH '$.slug', source_value VARCHAR(128) PATH '$.sourceValue', is_primary JSON PATH '$.primary')) c
        WHERE d.kind = ${kind}`)) as unknown as [{ affectedRows: number }]
      return { kind, rows: keys.affectedRows, indexable: Number(indexable?.n ?? 0), categories: categories.affectedRows, seconds: Math.round((Date.now() - started) / 1000) }
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${LOCK})`)
    }
  })
}

export async function syncListKeys(db: Db, kinds: readonly EntityKind[], logger: Logger): Promise<ListKeyStats[]> {
  const all: ListKeyStats[] = []
  for (const kind of kinds) {
    const stats = await syncKind(db, kind)
    logger.info(stats, '列表键表已重建')
    all.push(stats)
  }
  return all
}
