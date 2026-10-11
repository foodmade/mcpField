import { and, asc, gt, inArray } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { SourceRecord } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestRecords } from '../db/schema/index.ts'
import { runBatches, type BatchJob, type BatchStats } from '../llm/batch.ts'
import type { DescribeStore } from './store.ts'
import { describeKey, type DescribeInput, type DescribeKind, type DescribeResult, type DescribeWriter } from './types.ts'
import { validateDescription } from './validate.ts'

/** 各数据源把自己的源记录整理成事实（源站字段名各不相同，由数据源自己实现） */
export type FactExtractor = (record: SourceRecord) => DescribeInput | null

export async function collectDescribeInputs(db: Db, kinds: readonly DescribeKind[], extractors: Record<string, FactExtractor>): Promise<DescribeInput[]> {
  const inputs: DescribeInput[] = []
  let lastId = 0
  for (;;) {
    const rows = await db
      .select()
      .from(ingestRecords)
      .where(and(inArray(ingestRecords.kind, [...kinds]), gt(ingestRecords.id, lastId)))
      .orderBy(asc(ingestRecords.id))
      .limit(200)
    if (rows.length === 0) break
    for (const row of rows) {
      const extract = extractors[row.sourceId]
      const input = extract?.({ sourceId: row.sourceId, kind: row.kind, externalId: row.externalId, url: row.url, parserVersion: row.parserVersion, fetchedAt: row.fetchedAt, data: row.data })
      if (input) inputs.push(input)
    }
    lastId = rows.at(-1)!.id
  }
  return inputs
}

export interface DescribeOptions {
  limit?: number
  stale?: boolean
  force?: boolean
  concurrency: number
  signal?: AbortSignal
}

/** 每次请求的条数：Loop 输出长，一次 2 条；CLI / Agent 一次 6 条 */
const BATCH: Record<DescribeKind, number> = { loop: 2, cli: 6, agent: 6 }

export type DescribeStats = Omit<BatchStats, 'total'> & { inputs: number; pending: number }

/** 生成我们自己的三语内容：输入（事实）没变就跳过 → 按类型分组、选模型 → 通用批处理（校验不合格的重写）→ 入库 */
export class DescribeRunner {
  constructor(
    private readonly writerFor: (kind: DescribeKind) => DescribeWriter,
    private readonly store: Pick<DescribeStore, 'existing' | 'save'>,
    private readonly logger: Logger,
  ) {}

  async run(inputs: DescribeInput[], options: DescribeOptions): Promise<DescribeStats> {
    const existing = options.force ? new Map() : await this.store.existing(inputs)
    let pending = inputs.filter((input) => {
      const prev = existing.get(describeKey(input))
      if (!prev || prev.locales < 3 || prev.inputHash !== input.inputHash) return true
      return !!options.stale && prev.promptVersion < this.writerFor(input.kind).promptVersion
    })
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)

    const total: DescribeStats = { inputs: inputs.length, pending: pending.length, ok: 0, review: 0, failed: 0, requests: 0, inputTokens: 0, outputTokens: 0, seconds: 0 }
    const kinds = [...new Set(pending.map((i) => i.kind))]
    this.logger.info({ inputs: inputs.length, pending: pending.length, groups: kinds.map((k) => `${k} → ${this.writerFor(k).model}: ${pending.filter((i) => i.kind === k).length}`) }, '开始生成内容')

    for (const kind of kinds) {
      const writer = this.writerFor(kind)
      const job: BatchJob<DescribeInput, DescribeResult> = {
        key: describeKey,
        size: (i) => JSON.stringify(i.facts).length,
        call: async (batch, signal) => {
          const { results, usage } = await writer.write(batch, signal)
          return { results: new Map(results.map((r) => [r.key, r])), usage }
        },
        validate: validateDescription,
        save: (input, result, problems) => this.store.save(input, result, problems, writer),
        describe: (i) => `${i.kind}/${i.externalId}`,
      }
      const list = pending.filter((i) => i.kind === kind)
      const stats = await runBatches(list, job, { batchSize: BATCH[kind], maxBatchChars: 60_000, concurrency: options.concurrency, retryBatchSize: 1, signal: options.signal }, this.logger)
      for (const k of ['ok', 'review', 'failed', 'requests', 'inputTokens', 'outputTokens', 'seconds'] as const) total[k] += stats[k]
    }
    return total
  }
}
