import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { runBatches, type BatchJob, type BatchOptions, type BatchStats } from '../llm/batch.ts'
import { draftsWithReadme } from '../readme/source.ts'
import { inputFromDraft } from './prepare.ts'
import type { OverviewStore } from './store.ts'
import { overviewKey, type OverviewInput, type OverviewResult, type OverviewWriter } from './types.ts'
import { validateOverview } from './validate.ts'

/** 分页读取草稿并构造输入（README 用 GitHub 的）；README 不足的条目跳过。按星数从高到低排，热门条目先生成 */
export async function collectOverviewInputs(db: Db, kinds: readonly EntityKind[], minStars = 0): Promise<{ inputs: OverviewInput[]; skipped: number }> {
  const inputs: OverviewInput[] = []
  let skipped = 0
  for await (const { draft, readme, stars } of draftsWithReadme(db, kinds)) {
    const input = inputFromDraft(draft, readme?.content ?? '', stars)
    if (!input || (input.stars ?? 0) < minStars) skipped++
    else inputs.push(input)
  }
  inputs.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
  return { inputs, skipped }
}

export interface OverviewOptions extends BatchOptions {
  limit?: number
  stale?: boolean
  force?: boolean
}

export type OverviewStats = Omit<BatchStats, 'total'> & { inputs: number; pending: number; premium: number }

/** 按热度选模型：星数达到门槛的用更强的模型 */
export interface WriterRouting {
  standard: OverviewWriter
  premium?: OverviewWriter
  premiumMinStars: number
}

/** 批量生成介绍：跳过输入没变的 → 按模型分组 → 通用批处理（分批、并发、校验、重做）→ 写库 */
export class OverviewRunner {
  constructor(
    private readonly writers: WriterRouting,
    private readonly store: Pick<OverviewStore, 'existing' | 'save'>,
    private readonly logger: Logger,
  ) {}

  async run(inputs: OverviewInput[], options: OverviewOptions): Promise<OverviewStats> {
    const existing = options.force ? new Map() : await this.store.existing(inputs)
    let pending = inputs.filter((input) => {
      const prev = existing.get(overviewKey(input))
      if (!prev || prev.locales < 3 || prev.inputHash !== input.inputHash) return true
      return !!options.stale && prev.promptVersion < this.writers.standard.promptVersion
    })
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)

    const { premium, premiumMinStars } = this.writers
    const isPremium = (i: OverviewInput) => !!premium && (i.stars ?? 0) >= premiumMinStars
    const groups: [OverviewWriter, OverviewInput[]][] = [
      [this.writers.standard, pending.filter((i) => !isPremium(i))],
      ...(premium ? [[premium, pending.filter(isPremium)] as [OverviewWriter, OverviewInput[]]] : []),
    ]
    this.logger.info({ inputs: inputs.length, pending: pending.length, groups: groups.map(([w, list]) => `${w.model}: ${list.length}`) }, '开始生成介绍')

    const total: OverviewStats = { inputs: inputs.length, pending: pending.length, premium: groups[1]?.[1].length ?? 0, ok: 0, review: 0, failed: 0, requests: 0, inputTokens: 0, outputTokens: 0, seconds: 0 }
    for (const [writer, list] of groups) {
      if (list.length === 0) continue
      const job: BatchJob<OverviewInput, OverviewResult> = {
        key: overviewKey,
        size: (i) => i.readme.length,
        call: async (batch, signal) => {
          const { results, usage } = await writer.write(batch, signal)
          return { results: new Map(results.map((r) => [r.key, r])), usage }
        },
        validate: validateOverview,
        save: (input, result, problems) => this.store.save(input, result, problems, writer),
        describe: (i) => `${i.kind}/${i.externalId}`,
      }
      const stats = await runBatches(list, job, { ...options, retryBatchSize: 1 }, this.logger)
      for (const k of ['ok', 'review', 'failed', 'requests', 'inputTokens', 'outputTokens', 'seconds'] as const) total[k] += stats[k]
    }
    return total
  }
}

