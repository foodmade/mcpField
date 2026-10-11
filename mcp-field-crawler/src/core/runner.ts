import { HttpError } from './errors.ts'
import type { CrawlEvents } from './events.ts'
import type { Logger } from './logger.ts'
import type { DiscoverOptions, SourceKit } from './source.ts'
import { emptyStats, type IngestStore, type RecordSource, type RunStats, type TargetState } from './store.ts'
import type { CrawlTarget, EntityKind } from './types.ts'

export interface RunOptions extends DiscoverOptions {
  /** 忽略增量判断，强制重新抓取和解析 */
  force?: boolean
}

export interface RunnerDeps {
  kit: SourceKit
  store: IngestStore
  events: CrawlEvents
  logger: Logger
}

/** 站点地图的 lastmod 不晚于上次成功抓取的时间，就认为没有变化 */
function isFresh(target: CrawlTarget, prev: TargetState | null): boolean {
  if (!prev?.fetchedAt || !target.lastmod) return false
  if (prev.state !== 'fetched' && prev.state !== 'not_modified') return false
  return target.lastmod.getTime() <= prev.fetchedAt.getTime()
}

/**
 * 运行器（模板方法）：run() 固定了"开始运行 → 逐个发现目标 → 增量判断 → 分派 → 收尾"的流程，
 * 子类只决定目标如何处理：DiscoverRunner 只登记目标，InlineRunner 在本进程内抓取并解析。
 * 以后的多进程 Worker 也只需从 ingest_targets 领取目标，复用 TargetProcessor。
 */
export abstract class CrawlRunner {
  protected abstract readonly command: string
  protected readonly stats: RunStats = emptyStats()

  constructor(protected readonly deps: RunnerDeps) {}

  async run(options: RunOptions): Promise<RunStats> {
    const { kit, store, events } = this.deps
    await store.registerSource(kit.meta)
    const runId = await store.beginRun({ sourceId: kit.meta.id, command: this.command, options: { ...options, signal: undefined } })
    let failure: unknown
    try {
      for await (const target of kit.discoverer.discover(options)) {
        if (options.signal?.aborted) break
        this.stats.discovered++
        events.emit('discovered', target)
        const prev = await store.upsertTarget(target, runId)
        if (!options.force && isFresh(target, prev)) {
          this.stats.skipped++
          events.emit('skipped', target, 'lastmod 未变化')
          continue
        }
        await this.dispatch(target, prev, runId, options)
      }
      await this.drain()
    } catch (error) {
      failure = error
      throw error
    } finally {
      await store.finishRun(runId, this.stats, failure, options.signal?.aborted ?? false)
    }
    return this.stats
  }

  protected abstract dispatch(target: CrawlTarget, prev: TargetState | null, runId: string, options: RunOptions): Promise<void>
  protected abstract drain(): Promise<void>
}

/** 只发现并登记目标（写入 ingest_targets），不抓取详情页 */
export class DiscoverRunner extends CrawlRunner {
  protected readonly command = 'discover'
  protected async dispatch(): Promise<void> {}
  protected async drain(): Promise<void> {}
}

/** 处理单个目标：抓取 → 保存原始文档 → 解析 → 映射 → 保存。Inline 和以后的 Worker 共用 */
export class TargetProcessor {
  constructor(private readonly deps: RunnerDeps) {}

  async process(
    target: CrawlTarget,
    prev: TargetState | null,
    runId: string,
    stats: RunStats,
    force = false,
  ): Promise<void> {
    const { kit, store, events } = this.deps
    const conditional = force || !prev ? undefined : { etag: prev.etag, lastModified: prev.lastModified }
    const doc = await kit.fetcher.fetch({ url: target.url, conditional })
    const { changed } = await store.saveDocument(target, doc, runId)
    if (doc.notModified) {
      stats.notModified++
      events.emit('skipped', target, '304 未修改')
      return
    }
    stats.fetched++
    events.emit('fetched', target, doc)
    if (!changed && !force) {
      stats.unchanged++
      events.emit('skipped', target, '内容未变化')
      return
    }

    const records = await kit.parserFor(target.kind).parse(doc, target)
    const mapper = kit.mapperFor(target.kind)
    const drafts = records.map((record) => mapper.map(record)).filter((draft) => draft !== null)
    await store.saveRecords(target, records)
    await store.saveDrafts(target, drafts, mapper.version, runId)
    stats.records += records.length
    stats.drafts += drafts.length
    events.emit('parsed', target, records.length, drafts.length)
  }
}

/** 在本进程内按数据源的并发上限处理目标 */
export class InlineRunner extends CrawlRunner {
  protected readonly command = 'crawl'
  private readonly processor = new TargetProcessor(this.deps)
  private readonly inflight = new Set<Promise<void>>()

  protected async dispatch(target: CrawlTarget, prev: TargetState | null, runId: string, options: RunOptions) {
    // 背压：在途任务过多时先等一个完成，避免一次性把上万个目标堆进内存
    const max = this.deps.kit.meta.politeness.concurrency
    while (this.inflight.size >= max) await Promise.race(this.inflight)

    const task = this.processor
      .process(target, prev, runId, this.stats, options.force)
      .catch((error: unknown) => this.onFailure(target, error, runId))
      .finally(() => this.inflight.delete(task))
    this.inflight.add(task)
  }

  protected async drain() {
    await Promise.all(this.inflight)
  }

  private async onFailure(target: CrawlTarget, error: unknown, runId: string) {
    this.stats.failed++
    const err = error instanceof Error ? error : new Error(String(error))
    this.deps.events.emit('failed', target, err)
    const level = error instanceof HttpError && error.gone ? 'warn' : 'error'
    this.deps.logger[level]({ url: target.url, err: err.message }, '目标处理失败')
    await this.deps.store.markFailed(target, error, runId)
  }
}

/** 用当前的映射器重建草稿：遍历已保存的源记录，不发任何网络请求 */
export async function remapRecords(
  deps: Omit<RunnerDeps, 'store'> & { store: IngestStore & RecordSource },
  kinds: readonly EntityKind[],
): Promise<RunStats> {
  const { kit, store, logger } = deps
  const stats = emptyStats()
  await store.registerSource(kit.meta)
  const runId = await store.beginRun({ sourceId: kit.meta.id, command: 'remap', options: { kinds } })
  let failure: unknown
  try {
    for await (const record of store.iterateRecords(kit.meta.id, kinds)) {
      const mapper = kit.mapperFor(record.kind)
      const target: CrawlTarget = { sourceId: record.sourceId, kind: record.kind, externalId: record.externalId, url: record.url }
      try {
        const draft = mapper.map(record)
        await store.saveDrafts(target, draft ? [draft] : [], mapper.version, runId)
        stats.records++
        if (draft) stats.drafts++
      } catch (error) {
        stats.failed++
        logger.error({ kind: record.kind, id: record.externalId, err: String(error) }, '重建草稿失败')
      }
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    await store.finishRun(runId, stats, failure)
  }
  return stats
}
