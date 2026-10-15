import { sql } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'

/*
 * 重建标签表 ingest_tags：把发布层草稿的 tags 展开成一行一个标签。
 * 标签只在 publish 时变化，publish 和 search-index 结束时执行；一类不到十万行，整类删掉重插比逐行比对简单。
 */

export interface TagIndexStats {
  kind: EntityKind
  rows: number
  seconds: number
}

/** 同一时间只跑一个重建：每日任务和手动运行的命令可能重叠 */
const LOCK = 'ingest_tags_sync'

async function syncKind(db: Db, kind: EntityKind): Promise<TagIndexStats> {
  const started = Date.now()
  // 一个类型一个事务：重建期间网站读到的仍是旧数据
  return db.transaction(async (tx) => {
    const [[lock]] = (await tx.execute(sql`SELECT GET_LOCK(${LOCK}, 600) AS ok`)) as unknown as [{ ok: number | null }[]]
    if (Number(lock?.ok) !== 1) throw new Error('另一个标签表重建一直没有结束（等了 10 分钟）')
    try {
      await tx.execute(sql`DELETE FROM ingest_tags WHERE kind = ${kind}`)
      // 超过列宽的标签（JSON_TABLE 取不出时为 NULL）跳过
      const [result] = (await tx.execute(sql`
        INSERT IGNORE INTO ingest_tags (kind, tag, slug)
        SELECT p.kind, j.tag, p.slug
        FROM ingest_published p, JSON_TABLE(p.draft, '$.tags[*]' COLUMNS (tag varchar(255) PATH '$' NULL ON ERROR)) j
        WHERE p.kind = ${kind} AND j.tag IS NOT NULL AND j.tag <> ''`)) as unknown as [{ affectedRows: number }]
      return { kind, rows: result.affectedRows, seconds: Math.round((Date.now() - started) / 1000) }
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${LOCK})`)
    }
  })
}

export async function syncTagIndex(db: Db, kinds: readonly EntityKind[], logger: Logger): Promise<TagIndexStats[]> {
  const all: TagIndexStats[] = []
  for (const kind of kinds) {
    const stats = await syncKind(db, kind)
    logger.info(stats, '标签表已重建')
    all.push(stats)
  }
  return all
}
