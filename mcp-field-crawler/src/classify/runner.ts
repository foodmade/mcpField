import type { CategoryDraft, EntityDraft } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { runBatches, type BatchJob, type BatchOptions, type BatchStats } from '../llm/batch.ts'
import { draftsWithReadme } from '../readme/source.ts'
import { CLASSIFIER_SOURCE, CLASSIFY_PROMPT_VERSION, classifyKey, inputFromDraft, needsClassification, validateClassification, type LlmClassifier, type ClassifyInput, type ClassifyResult } from './classifier.ts'
import type { ClassificationStore, StoredClassification } from './store.ts'
import { OTHER, TAXONOMY_VERSION } from './taxonomy.ts'

/**
 * 从发布层收集要分类的条目：默认只要来源没有给出可用分类的；all = 全部（用来和源站分类对比评估）。
 * 按星数从高到低排，热门条目先分类。
 */
export async function collectClassifyInputs(db: Db, kinds: readonly EntityKind[], options: { all?: boolean } = {}): Promise<ClassifyInput[]> {
  const inputs: ClassifyInput[] = []
  for await (const { draft, readme, stars } of draftsWithReadme(db, kinds)) {
    if (options.all || needsClassification(draft)) inputs.push(inputFromDraft(draft, readme?.content ?? '', stars))
  }
  return inputs.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
}

export interface ClassifyOptions extends BatchOptions {
  limit?: number
  /** 忽略已有结果全部重新分类 */
  force?: boolean
}

export type ClassifyStats = Omit<BatchStats, 'total'> & { inputs: number; pending: number }

export class ClassifyRunner {
  constructor(
    private readonly classifier: Pick<LlmClassifier, 'model' | 'classify'>,
    private readonly store: Pick<ClassificationStore, 'existing' | 'save'>,
    private readonly logger: Logger,
  ) {}

  async run(inputs: ClassifyInput[], options: ClassifyOptions): Promise<ClassifyStats> {
    const existing = options.force ? new Map() : await this.store.existing(inputs)
    let pending = inputs.filter((input) => {
      const prev = existing.get(classifyKey(input))
      return !prev || prev.inputHash !== input.inputHash || prev.promptVersion < CLASSIFY_PROMPT_VERSION
    })
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)
    this.logger.info({ inputs: inputs.length, pending: pending.length, model: this.classifier.model }, '开始分类')

    const meta = { model: this.classifier.model, promptVersion: CLASSIFY_PROMPT_VERSION, taxonomyVersion: TAXONOMY_VERSION }
    const total: ClassifyStats = { inputs: inputs.length, pending: pending.length, ok: 0, review: 0, failed: 0, requests: 0, inputTokens: 0, outputTokens: 0, seconds: 0 }
    // 不同类型的分类体系不同，分开成批
    for (const kind of new Set(pending.map((i) => i.kind))) {
      const job: BatchJob<ClassifyInput, ClassifyResult> = {
        key: classifyKey,
        size: (i) => i.readme.length + (i.tagline?.length ?? 0) + 200,
        call: async (batch, signal) => {
          const { results, usage } = await this.classifier.classify(batch, signal)
          return { results: new Map(results.map((r) => [r.key, r])), usage }
        },
        validate: validateClassification,
        save: (input, result, problems) => this.store.save(input, result, problems, meta),
        describe: (i) => `${i.kind}/${i.externalId}`,
      }
      const stats = await runBatches(
        pending.filter((i) => i.kind === kind),
        job,
        options,
        this.logger,
      )
      for (const k of ['ok', 'review', 'failed', 'requests', 'inputTokens', 'outputTokens', 'seconds'] as const) total[k] += stats[k]
    }
    return total
  }
}

/** 发布时：来源没有给出可用分类的条目，换成分类器的结果（主分类为"其他"的保持没有分类） */
export function applyClassification(draft: EntityDraft, result: StoredClassification | undefined): void {
  if (!result || !needsClassification(draft) || result.primary === OTHER) return
  const categories: CategoryDraft[] = [
    { slug: result.primary, sourceValue: CLASSIFIER_SOURCE, primary: true },
    ...result.secondary.map((slug) => ({ slug, sourceValue: CLASSIFIER_SOURCE, primary: false })),
  ]
  draft.categories = categories
}
