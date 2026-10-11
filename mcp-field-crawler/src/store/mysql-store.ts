import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { hostname } from 'node:os'
import type { EntityDraft } from '../core/draft.ts'
import { HttpError, RobotsDisallowedError } from '../core/errors.ts'
import type { SourceMeta } from '../core/source.ts'
import type { IngestStore, RecordSource, RunInfo, RunStats, TargetState } from '../core/store.ts'
import type { CrawlTarget, EntityKind, RawDocument, SourceRecord } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { withDeadlockRetry } from '../db/retry.ts'
import { ingestDocuments, ingestDrafts, ingestIssues, ingestRecords, ingestRuns, ingestSources, ingestTargets } from '../db/schema/index.ts'
import type { BlobStore } from './blob-store.ts'
import { safeSegment, sha256, stableJson } from './hash.ts'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 失败后的重试间隔：1h、2h、4h……最长 7 天 */
const RETRY_BACKOFF_SQL = sql`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL LEAST(POW(2, ${ingestTargets.failCount}), 168) HOUR)`

const RECORD_BATCH = 200

export class MySqlIngestStore implements IngestStore, RecordSource {
  private readonly targetIds = new Map<string, number>()

  constructor(
    private readonly db: Db,
    private readonly blobs: BlobStore,
    private readonly onClose: () => Promise<void>,
  ) {}

  async registerSource(meta: SourceMeta): Promise<void> {
    const values = { name: meta.name, homepage: meta.homepage, politeness: meta.politeness }
    await this.db.insert(ingestSources).values({ id: meta.id, ...values }).onDuplicateKeyUpdate({ set: values })
  }

  async beginRun(info: RunInfo): Promise<string> {
    await this.abortOrphanedRuns()
    const [row] = await this.db
      .insert(ingestRuns)
      .values({ sourceId: info.sourceId, command: info.command, options: info.options, host: hostname(), pid: process.pid, startedAt: new Date() })
      .$returningId()
    return String(row!.id)
  }

  /** 本机上进程已不存在、却仍标记为 running 的运行（被强制结束），改为 aborted */
  private async abortOrphanedRuns(): Promise<void> {
    const host = hostname()
    const running = await this.db
      .select({ id: ingestRuns.id, pid: ingestRuns.pid })
      .from(ingestRuns)
      .where(and(eq(ingestRuns.status, 'running'), eq(ingestRuns.host, host)))
    for (const run of running) {
      if (run.pid && isAlive(run.pid)) continue
      await this.db
        .update(ingestRuns)
        .set({ status: 'aborted', error: '进程已退出，运行未正常结束', finishedAt: new Date() })
        .where(eq(ingestRuns.id, run.id))
    }
  }

  async finishRun(runId: string, stats: RunStats, error?: unknown, aborted = false): Promise<void> {
    await this.db
      .update(ingestRuns)
      .set({
        status: error ? 'failed' : aborted ? 'aborted' : 'succeeded',
        targetsDiscovered: stats.discovered,
        targetsSkipped: stats.skipped,
        docsFetched: stats.fetched,
        docsNotModified: stats.notModified,
        docsUnchanged: stats.unchanged,
        recordsParsed: stats.records,
        draftsMapped: stats.drafts,
        failures: stats.failed,
        error: error ? String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 4000) : null,
        finishedAt: new Date(),
      })
      .where(eq(ingestRuns.id, Number(runId)))
  }

  async upsertTarget(target: CrawlTarget, runId: string): Promise<TargetState | null> {
    const urlHash = sha256(target.url)
    const [prev] = await this.db
      .select({
        id: ingestTargets.id,
        state: ingestTargets.state,
        etag: ingestTargets.etag,
        lastModified: ingestTargets.lastModified,
        fetchedAt: ingestTargets.fetchedAt,
        contentHash: ingestTargets.contentHash,
      })
      .from(ingestTargets)
      .where(and(eq(ingestTargets.sourceId, target.sourceId), eq(ingestTargets.urlHash, urlHash)))
      .limit(1)

    const now = new Date()
    const changing = {
      kind: target.kind,
      externalId: target.externalId,
      url: target.url,
      urlHash,
      sitemapLastmod: target.lastmod ?? null,
      lastSeenAt: now,
      lastRunId: Number(runId),
    }
    const [row] = await this.db
      .insert(ingestTargets)
      .values({ sourceId: target.sourceId, priority: target.priority ?? 0, discoveredAt: now, ...changing })
      .onDuplicateKeyUpdate({ set: changing })
      .$returningId()

    const id = prev?.id ?? row?.id ?? (await this.lookupTargetId(target))
    this.targetIds.set(urlHash, id)
    if (!prev) return null
    return {
      state: prev.state,
      etag: prev.etag ?? undefined,
      lastModified: prev.lastModified ?? undefined,
      fetchedAt: prev.fetchedAt ?? undefined,
      contentHash: prev.contentHash ?? undefined,
    }
  }

  private async lookupTargetId(target: CrawlTarget): Promise<number> {
    const urlHash = sha256(target.url)
    const cached = this.targetIds.get(urlHash)
    if (cached) return cached
    const [row] = await this.db
      .select({ id: ingestTargets.id })
      .from(ingestTargets)
      .where(and(eq(ingestTargets.sourceId, target.sourceId), eq(ingestTargets.urlHash, urlHash)))
      .limit(1)
    if (!row) throw new Error(`目标未登记：${target.url}`)
    this.targetIds.set(urlHash, row.id)
    return row.id
  }

  async saveDocument(target: CrawlTarget, doc: RawDocument, runId: string): Promise<{ changed: boolean }> {
    const targetId = await this.lookupTargetId(target)
    const [prev] = await this.db.select({ contentHash: ingestTargets.contentHash }).from(ingestTargets).where(eq(ingestTargets.id, targetId))
    const base = {
      targetId,
      runId: Number(runId),
      requestedUrl: doc.requestedUrl,
      finalUrl: doc.url,
      httpStatus: doc.status,
      contentType: doc.headers['content-type']?.slice(0, 128) ?? null,
      durationMs: doc.durationMs,
      fetchedAt: doc.fetchedAt,
    }

    if (doc.notModified) {
      await this.db.insert(ingestDocuments).values({ ...base, notModified: true, contentHash: prev?.contentHash ?? null })
      await this.db
        .update(ingestTargets)
        .set({ state: 'not_modified', httpStatus: 304, fetchedAt: doc.fetchedAt, failCount: 0, lastError: null, nextFetchAt: null })
        .where(eq(ingestTargets.id, targetId))
      return { changed: false }
    }

    const contentHash = sha256(doc.body)
    const changed = contentHash !== prev?.contentHash
    const blobKey = `${safeSegment(target.sourceId)}/${target.kind}/${safeSegment(target.externalId)}/${contentHash}.html.gz`
    if (changed) await this.blobs.put(blobKey, doc.body)

    await this.db.insert(ingestDocuments).values({ ...base, bytes: Buffer.byteLength(doc.body), contentHash, blobKey })
    await this.db
      .update(ingestTargets)
      .set({
        state: 'fetched',
        httpStatus: doc.status,
        etag: doc.headers.etag?.slice(0, 255) ?? null,
        lastModified: doc.headers['last-modified']?.slice(0, 64) ?? null,
        contentHash,
        fetchedAt: doc.fetchedAt,
        failCount: 0,
        lastError: null,
        nextFetchAt: null,
      })
      .where(eq(ingestTargets.id, targetId))
    return { changed }
  }

  async saveRecords(target: CrawlTarget, records: SourceRecord[]): Promise<void> {
    const targetId = await this.lookupTargetId(target)
    for (const record of records) {
      const contentHash = sha256(stableJson(record.data))
      const where = and(
        eq(ingestRecords.sourceId, record.sourceId),
        eq(ingestRecords.kind, record.kind),
        eq(ingestRecords.externalId, record.externalId),
      )
      const [prev] = await this.db.select({ contentHash: ingestRecords.contentHash, changedAt: ingestRecords.changedAt }).from(ingestRecords).where(where)
      const now = new Date()
      const values = {
        targetId,
        url: record.url,
        parserVersion: record.parserVersion,
        contentHash,
        data: record.data,
        fetchedAt: record.fetchedAt,
        parsedAt: now,
        changedAt: prev && prev.contentHash === contentHash ? prev.changedAt : now,
      }
      await this.db
        .insert(ingestRecords)
        .values({ sourceId: record.sourceId, kind: record.kind, externalId: record.externalId, ...values })
        .onDuplicateKeyUpdate({ set: values })
    }
  }

  async saveDrafts(_target: CrawlTarget, drafts: EntityDraft[], mapperVersion: number, runId: string): Promise<void> {
    for (const draft of drafts) {
      await withDeadlockRetry(() => this.db.transaction(async (tx) => {
        const [record] = await tx
          .select({ id: ingestRecords.id })
          .from(ingestRecords)
          .where(and(eq(ingestRecords.sourceId, draft.sourceId), eq(ingestRecords.kind, draft.kind), eq(ingestRecords.externalId, draft.externalId)))
        if (!record) throw new Error(`草稿缺少对应的源记录：${draft.sourceId}/${draft.kind}/${draft.externalId}`)

        const values = {
          identityKey: draft.identityKey,
          mapperVersion,
          draftHash: sha256(stableJson(draft)),
          draft,
          mappedAt: new Date(),
        }
        await tx
          .insert(ingestDrafts)
          .values({ recordId: record.id, sourceId: draft.sourceId, kind: draft.kind, externalId: draft.externalId, ...values })
          .onDuplicateKeyUpdate({ set: values })
        const [row] = await tx.select({ id: ingestDrafts.id }).from(ingestDrafts).where(eq(ingestDrafts.recordId, record.id))

        // 问题列表每次映射时整体重建，反映当前数据的状态
        await tx.delete(ingestIssues).where(eq(ingestIssues.draftId, row!.id))
        if (draft.issues.length > 0) {
          const now = new Date()
          await tx.insert(ingestIssues).values(
            draft.issues.map((issue) => ({
              draftId: row!.id,
              sourceId: draft.sourceId,
              kind: draft.kind,
              externalId: draft.externalId,
              code: issue.code,
              detail: issue.detail?.slice(0, 1024) ?? null,
              runId: Number(runId),
              createdAt: now,
            })),
          )
        }
      }))
    }
  }

  async markFailed(target: CrawlTarget, error: unknown, runId: string): Promise<void> {
    const targetId = await this.lookupTargetId(target)
    const state = error instanceof HttpError && error.gone ? 'gone' : error instanceof RobotsDisallowedError ? 'blocked' : 'failed'
    await this.db
      .update(ingestTargets)
      .set({
        state,
        httpStatus: error instanceof HttpError ? error.status : null,
        failCount: sql`${ingestTargets.failCount} + 1`,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 1024),
        nextFetchAt: RETRY_BACKOFF_SQL,
        lastRunId: Number(runId),
      })
      .where(eq(ingestTargets.id, targetId))
  }

  async *iterateRecords(sourceId: string, kinds: readonly EntityKind[]): AsyncIterable<SourceRecord> {
    let lastId = 0
    for (;;) {
      const rows = await this.db
        .select()
        .from(ingestRecords)
        .where(and(eq(ingestRecords.sourceId, sourceId), inArray(ingestRecords.kind, [...kinds]), gt(ingestRecords.id, lastId)))
        .orderBy(asc(ingestRecords.id))
        .limit(RECORD_BATCH)
      if (rows.length === 0) return
      for (const row of rows) {
        yield {
          sourceId: row.sourceId,
          kind: row.kind,
          externalId: row.externalId,
          url: row.url,
          parserVersion: row.parserVersion,
          fetchedAt: row.fetchedAt,
          data: row.data,
        }
      }
      lastId = rows.at(-1)!.id
    }
  }

  async close(): Promise<void> {
    await this.onClose()
  }
}
