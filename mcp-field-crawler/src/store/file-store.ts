import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntityDraft } from '../core/draft.ts'
import type { SourceMeta } from '../core/source.ts'
import type { IngestStore, RunInfo, RunStats, TargetState } from '../core/store.ts'
import type { CrawlTarget, RawDocument, SourceRecord } from '../core/types.ts'
import { FsBlobStore } from './blob-store.ts'
import { safeSegment, sha256 } from './hash.ts'

/**
 * 本地调试用的存储：每次运行输出到 data/runs/<时间>_<数据源>/ 下的 JSONL 文件，
 * 不需要数据库，也不做增量（每次都完整抓取）。
 */
export class FileStore implements IngestStore {
  private dir = ''
  private blobs!: FsBlobStore
  private writing = Promise.resolve()

  constructor(private readonly root: string) {}

  /** 串行追加，避免并发写入同一个文件时行与行交错 */
  private write(file: string, row: unknown): Promise<void> {
    const line = JSON.stringify(row) + '\n'
    this.writing = this.writing.then(() => appendFile(join(this.dir, file), line))
    return this.writing
  }

  get outputDir(): string {
    return this.dir
  }

  async registerSource(_meta: SourceMeta): Promise<void> {}

  async beginRun(info: RunInfo): Promise<string> {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safeSegment(info.sourceId)}`
    this.dir = join(this.root, 'runs', runId)
    this.blobs = new FsBlobStore(join(this.dir, 'raw'))
    await mkdir(this.dir, { recursive: true })
    await this.write('run.jsonl', { event: 'begin', ...info, at: new Date() })
    return runId
  }

  async finishRun(_runId: string, stats: RunStats, error?: unknown, aborted = false): Promise<void> {
    await this.write('run.jsonl', { event: 'finish', stats, aborted, error: error ? String(error) : undefined, at: new Date() })
  }

  async upsertTarget(target: CrawlTarget): Promise<TargetState | null> {
    await this.write('targets.jsonl', target)
    return null
  }

  async saveDocument(target: CrawlTarget, doc: RawDocument): Promise<{ changed: boolean }> {
    const { body, ...meta } = doc
    const contentHash = doc.notModified ? undefined : sha256(body)
    if (!doc.notModified) await this.blobs.put(`${target.kind}/${safeSegment(target.externalId)}.html.gz`, body)
    await this.write('documents.jsonl', { ...meta, externalId: target.externalId, bytes: Buffer.byteLength(body), contentHash })
    return { changed: !doc.notModified }
  }

  async saveRecords(_target: CrawlTarget, records: SourceRecord[]): Promise<void> {
    for (const record of records) await this.write('records.jsonl', record)
  }

  async saveDrafts(_target: CrawlTarget, drafts: EntityDraft[]): Promise<void> {
    for (const draft of drafts) {
      await this.write('drafts.jsonl', draft)
      for (const issue of draft.issues) await this.write('issues.jsonl', { kind: draft.kind, externalId: draft.externalId, ...issue })
    }
  }

  async markFailed(target: CrawlTarget, error: unknown): Promise<void> {
    await this.write('failures.jsonl', { ...target, error: String(error instanceof Error ? error.message : error) })
  }

  async close(): Promise<void> {
    await this.writing
  }
}
