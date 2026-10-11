import type { EntityDraft } from './draft.ts'
import type { SourceMeta } from './source.ts'
import type { CrawlTarget, EntityKind, RawDocument, SourceRecord } from './types.ts'

/** 目标上一次被抓取时的状态，用于增量判断和条件请求 */
export interface TargetState {
  state?: string
  etag?: string
  lastModified?: string
  fetchedAt?: Date
  contentHash?: string
}

export interface RunInfo {
  sourceId: string
  command: string
  options: Record<string, unknown>
}

export interface RunStats {
  discovered: number
  skipped: number
  fetched: number
  notModified: number
  unchanged: number
  records: number
  drafts: number
  failed: number
}

export function emptyStats(): RunStats {
  return { discovered: 0, skipped: 0, fetched: 0, notModified: 0, unchanged: 0, records: 0, drafts: 0, failed: 0 }
}

/**
 * 采集数据的仓储接口（仓储模式）。运行器只依赖这个接口：
 * MySqlIngestStore 用于正式运行，FileStore 用于本地调试（输出 JSONL）。
 */
export interface IngestStore {
  registerSource(meta: SourceMeta): Promise<void>
  beginRun(info: RunInfo): Promise<string>
  /** aborted：被中断信号提前结束 */
  finishRun(runId: string, stats: RunStats, error?: unknown, aborted?: boolean): Promise<void>
  /** 写入或更新目标，返回它上一次的状态（新目标返回 null） */
  upsertTarget(target: CrawlTarget, runId: string): Promise<TargetState | null>
  /** 保存原始文档；内容与上次相同时返回 changed: false */
  saveDocument(target: CrawlTarget, doc: RawDocument, runId: string): Promise<{ changed: boolean }>
  saveRecords(target: CrawlTarget, records: SourceRecord[]): Promise<void>
  saveDrafts(target: CrawlTarget, drafts: EntityDraft[], mapperVersion: number, runId: string): Promise<void>
  markFailed(target: CrawlTarget, error: unknown, runId: string): Promise<void>
  close(): Promise<void>
}

/** 能按来源和类型遍历已保存源记录的存储；用于映射逻辑变化后重建草稿，无需重新抓取 */
export interface RecordSource {
  iterateRecords(sourceId: string, kinds: readonly EntityKind[]): AsyncIterable<SourceRecord>
}

export function isRecordSource(store: IngestStore): store is IngestStore & RecordSource {
  return typeof (store as Partial<RecordSource>).iterateRecords === 'function'
}
