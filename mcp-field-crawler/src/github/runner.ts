import { and, asc, gt, inArray } from 'drizzle-orm'
import pLimit from 'p-limit'
import { HttpError } from '../core/errors.ts'
import type { EntityDraft } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestPublished } from '../db/schema/index.ts'
import { readmeSubject, type GithubReadmeFetcher, type ReadmeSubject } from './readme.ts'
import { repoRef, type GithubRepoFetcher, type RepoRef } from './repo.ts'
import type { GithubReadmeStore, GithubRepoStore, ReadmeFetchState } from './store.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** 抓到后多久再检查一次更新（条件请求，没变化不占额度） */
const OK_TTL = 7 * DAY
/** 仓库或 README 不存在、文件过大：一个月后再试 */
const MISSING_TTL = 30 * DAY
/** subject_key 列的长度上限 */
const MAX_KEY_LENGTH = 255

export interface CollectedSubject extends ReadmeSubject {
  /** 共用这个主体的条目数 */
  entries: number
}

/** 分页读取草稿，收集要抓 README 的主体（同一个仓库目录下的多个条目只抓一次）和要更新统计的仓库 */
export async function collectGithubTargets(db: Db, kinds: readonly EntityKind[]): Promise<{ readmes: CollectedSubject[]; repos: RepoRef[] }> {
  const subjects = new Map<string, CollectedSubject>()
  const repos = new Map<string, RepoRef>()
  let lastId = 0
  for (;;) {
    const rows = await db
      .select({ id: ingestPublished.id, draft: ingestPublished.draft })
      .from(ingestPublished)
      .where(and(inArray(ingestPublished.kind, [...kinds]), gt(ingestPublished.id, lastId)))
      .orderBy(asc(ingestPublished.id))
      .limit(200)
    if (rows.length === 0) break
    for (const row of rows) {
      const d = row.draft as EntityDraft
      const repo = repoRef(d)
      if (repo && repo.key.length <= MAX_KEY_LENGTH) repos.set(repo.key, repo)
      const subject = readmeSubject(d)
      if (!subject || subject.key.length > MAX_KEY_LENGTH) continue
      const prev = subjects.get(subject.key)
      if (prev) prev.entries++
      else subjects.set(subject.key, { ...subject, entries: 1 })
    }
    lastId = rows.at(-1)!.id
  }
  return { readmes: [...subjects.values()], repos: [...repos.values()] }
}

export interface RepoStatsOptions {
  /** 每次 GraphQL 查询的仓库数 */
  batchSize: number
  /** GitHub 不建议并发 GraphQL 请求，保持较小 */
  concurrency: number
  limit?: number
  signal?: AbortSignal
}

export interface RepoStatsResult {
  repos: number
  ok: number
  notFound: number
  failed: number
  seconds: number
}

/** 仓库统计（星数、最近提交时间）：每次运行全部更新，GraphQL 每批一次请求；某批失败只跳过这一批，下次运行再更新 */
export class GithubRepoRunner {
  constructor(
    private readonly fetcher: Pick<GithubRepoFetcher, 'fetch'>,
    private readonly store: Pick<GithubRepoStore, 'save'>,
    private readonly logger: Logger,
  ) {}

  async run(repos: RepoRef[], options: RepoStatsOptions): Promise<RepoStatsResult> {
    const started = Date.now()
    const pending = options.limit !== undefined ? repos.slice(0, options.limit) : repos
    const result: RepoStatsResult = { repos: pending.length, ok: 0, notFound: 0, failed: 0, seconds: 0 }
    const batches: RepoRef[][] = []
    for (let i = 0; i < pending.length; i += options.batchSize) batches.push(pending.slice(i, i + options.batchSize))
    this.logger.info({ repos: pending.length, batches: batches.length }, '开始更新 GitHub 仓库统计')

    const limit = pLimit(options.concurrency)
    let finished = 0
    await Promise.all(
      batches.map((batch) =>
        limit(async () => {
          if (options.signal?.aborted) return
          try {
            const stats = await this.fetcher.fetch(batch, options.signal)
            await this.store.save(stats, new Date(Date.now() + DAY))
            for (const s of stats.values()) {
              if (s) result.ok++
              else result.notFound++
            }
          } catch (error) {
            if (options.signal?.aborted) return
            result.failed += batch.length
            this.logger.warn({ first: batch[0]!.key, size: batch.length, err: (error as Error).message }, '仓库统计更新失败，下次运行再试')
          }
          finished++
          if (finished % 20 === 0 || finished === batches.length) {
            this.logger.info({ progress: `${finished}/${batches.length}`, ok: result.ok, notFound: result.notFound, failed: result.failed }, '仓库统计进度')
          }
        }),
      ),
    )
    result.seconds = Math.round((Date.now() - started) / 1000)
    return result
  }
}

export interface GithubReadmeOptions {
  concurrency: number
  /** 忽略过期时间，全部重新请求 */
  force?: boolean
  limit?: number
  signal?: AbortSignal
}

export interface GithubReadmeStats {
  subjects: number
  pending: number
  ok: number
  notModified: number
  notFound: number
  tooLarge: number
  failed: number
  seconds: number
}

type Store = Pick<GithubReadmeStore, 'states' | 'saveOk' | 'saveNotModified' | 'saveMissing' | 'saveError'>

/** 没抓过的都要抓；抓过的到期才检查更新 */
function due(state: ReadmeFetchState | undefined, options: GithubReadmeOptions): boolean {
  if (options.force || !state) return true
  return !state.expiresAt || state.expiresAt.getTime() <= Date.now()
}

/**
 * GitHub README 抓取：按主体去重 → 跳过未到期的 → 并发请求（带 ETag，没变化返回 304）→ 写入 ingest_enrichments。
 * 临时错误按 1h、4h、16h……最长 7 天退避；已经抓到过的条目刷新失败时保留原内容。
 */
export class GithubReadmeRunner {
  constructor(
    private readonly fetcher: Pick<GithubReadmeFetcher, 'fetch'>,
    private readonly store: Store,
    private readonly logger: Logger,
  ) {}

  async run(subjects: CollectedSubject[], options: GithubReadmeOptions): Promise<GithubReadmeStats> {
    const started = Date.now()
    const states = await this.store.states(subjects.map((s) => s.key))
    let pending = subjects.filter((s) => due(states.get(s.key), options))
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)
    const stats: GithubReadmeStats = { subjects: subjects.length, pending: pending.length, ok: 0, notModified: 0, notFound: 0, tooLarge: 0, failed: 0, seconds: 0 }
    this.logger.info({ subjects: subjects.length, recorded: states.size, pending: pending.length }, '开始抓取 GitHub README')

    const limit = pLimit(options.concurrency)
    let finished = 0
    await Promise.all(
      pending.map((subject) =>
        limit(async () => {
          if (options.signal?.aborted) return
          const state = states.get(subject.key)
          // 强制重抓时不带 ETag，保证拿到完整内容
          const prev = state ? { etag: options.force ? null : state.etag, path: state.path } : undefined
          try {
            const result = await this.fetcher.fetch(subject, prev, options.signal)
            const now = Date.now()
            if (result.status === 'ok') {
              await this.store.saveOk(subject.key, result.readme, result.etag, new Date(now + OK_TTL))
              stats.ok++
            } else if (result.status === 'not_modified') {
              await this.store.saveNotModified(subject.key, new Date(now + OK_TTL))
              stats.notModified++
            } else {
              await this.store.saveMissing(subject.key, result.status, result.httpStatus, result.reason, new Date(now + MISSING_TTL))
              if (result.status === 'too_large') stats.tooLarge++
              else stats.notFound++
            }
          } catch (error) {
            if (options.signal?.aborted) return
            const attempts = (state?.status === 'error' ? state.attempts : 0) + 1
            const hours = Math.min(4 ** (attempts - 1), 168)
            await this.store.saveError(subject.key, (error as Error).message, error instanceof HttpError ? error.status : null, attempts, new Date(Date.now() + hours * HOUR), state?.status === 'ok')
            stats.failed++
            this.logger.warn({ subject: subject.key, err: (error as Error).message }, 'README 抓取失败')
          }
          finished++
          if (finished % 100 === 0 || finished === pending.length) {
            this.logger.info({ progress: `${finished}/${pending.length}`, ok: stats.ok, notModified: stats.notModified, notFound: stats.notFound, failed: stats.failed }, '抓取进度')
          }
        }),
      ),
    )
    stats.seconds = Math.round((Date.now() - started) / 1000)
    return stats
  }
}
