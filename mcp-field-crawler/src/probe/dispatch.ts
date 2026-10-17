import { setTimeout as sleep } from 'node:timers/promises'
import { sql } from 'drizzle-orm'
import type { EntityDraft } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { collectProbeTargets } from './local-targets.ts'
import { jobPool, QUEUE, type ProbeJob, type ProbePool, type ProbePriority, type QueueClient } from './queue.ts'
import { collectRemoteTargets } from './remote.ts'
import { ProbedToolsStore, probeKeys, type ToolsProbeResult } from './tools-store.ts'

/** 投递后超过这么久还没有结果（worker 被强行杀掉等），重新投递 */
const STALE_MS = 2 * 24 * 60 * 60 * 1000
/** 最近这么多天首次发现的服务算新收录，进 high 队列，每日任务会等它们的结果 */
const NEW_DAYS = 3
/** 等结果时多久取一次 */
const POLL_MS = 15_000

export interface DispatchOptions {
  /** 最多等新收录服务的结果多少分钟；0 表示投递完就退出，结果下次再导入 */
  waitMinutes: number
  /** 最多投递多少个目标（试跑用） */
  limit?: number
  signal?: AbortSignal
}

/** 取回结果写进 ingest_enrichments，并从 pending 里删掉；返回这次取到的主体键 */
async function drainResults(client: QueueClient, store: ProbedToolsStore, counts: Record<string, number>): Promise<string[]> {
  const keys: string[] = []
  for (;;) {
    const batch = await client.lPopCount(QUEUE.results, 200)
    if (!batch?.length) return keys
    const results = batch.map((line) => JSON.parse(line) as ToolsProbeResult)
    await store.save(results)
    await client.hDel(
      QUEUE.pending,
      results.map((r) => r.key),
    )
    for (const r of results) {
      counts[r.status] = (counts[r.status] ?? 0) + 1
      keys.push(r.key)
    }
  }
}

/** 最近首次发现、还没有工具列表的服务的实测键（discovered_at 按 UTC 存） */
async function newServerKeys(db: Db, days: number): Promise<Set<string>> {
  const [rows] = (await db.execute(sql`
    SELECT d.draft FROM ingest_published d
    JOIN ingest_targets t ON t.source_id = d.source_id AND t.kind = d.kind AND t.external_id = d.external_id
    WHERE d.kind = 'server'
      AND COALESCE(JSON_LENGTH(d.draft, '$.detail.tools'), 0) = 0
      AND t.discovered_at > UTC_TIMESTAMP() - INTERVAL ${days} DAY`)) as unknown as [{ draft: EntityDraft | string }[]]
  return new Set(rows.flatMap((r) => probeKeys((typeof r.draft === 'string' ? JSON.parse(r.draft) : r.draft) as EntityDraft)))
}

async function queueLengths(client: QueueClient) {
  const out: Record<string, number> = {}
  for (const pool of ['local', 'remote'] as ProbePool[]) for (const priority of ['high', 'low'] as ProbePriority[]) out[`${pool}:${priority}`] = await client.lLen(QUEUE.jobs(pool, priority))
  return out
}

/**
 * 每日任务里的 probe 步骤（在 publish 之前）：
 * 先导入实测机已经交回的结果 → 收集还没有工具列表的本地包和远程服务，投递到队列（已投递未出结果的不重复投；新收录的进 high）
 * → 最多等 waitMinutes 分钟，让新收录服务的结果赶上紧接着的 publish 和工具翻译。没等到的照常留在队列里，worker 会继续测，下次导入。
 */
export async function dispatchProbes(db: Db, client: QueueClient, logger: Logger, options: DispatchOptions) {
  const store = new ProbedToolsStore(db)
  const imported: Record<string, number> = {}
  await drainResults(client, store, imported)

  const [local, remote, fresh, pending] = await Promise.all([collectProbeTargets(db), collectRemoteTargets(db), newServerKeys(db, NEW_DAYS), client.hGetAll(QUEUE.pending)])
  const now = Date.now()
  const candidates = [...local, ...remote]
  const due = candidates.filter((job) => !(pending[job.key] && now - Number(pending[job.key]) < STALE_MS))
  const jobs: ProbeJob[] = due.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1)).slice(0, options.limit)

  const waiting = new Set<string>()
  const queued: Record<string, number> = {}
  for (let i = 0; i < jobs.length; i += 1000) {
    const multi = client.multi()
    for (const job of jobs.slice(i, i + 1000)) {
      const priority: ProbePriority = fresh.has(job.key) ? 'high' : 'low'
      if (priority === 'high') waiting.add(job.key)
      const name = `${jobPool(job)}:${priority}`
      queued[name] = (queued[name] ?? 0) + 1
      multi.rPush(QUEUE.jobs(jobPool(job), priority), JSON.stringify(job))
      multi.hSet(QUEUE.pending, job.key, String(now))
    }
    await multi.exec()
  }
  logger.info({ imported, candidates: candidates.length, alreadyPending: candidates.length - due.length, queued, queues: await queueLengths(client) }, '实测任务已投递')

  // 等新收录服务的结果
  const deadline = now + options.waitMinutes * 60_000
  while (waiting.size > 0 && Date.now() < deadline && !options.signal?.aborted) {
    await sleep(POLL_MS)
    for (const key of await drainResults(client, store, imported)) waiting.delete(key)
  }
  await drainResults(client, store, imported)
  return { imported, queued, newWaitingLeft: waiting.size, queues: await queueLengths(client) }
}
