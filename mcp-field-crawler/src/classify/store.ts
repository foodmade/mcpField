import { and, eq, inArray } from 'drizzle-orm'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { withDeadlockRetry } from '../db/retry.ts'
import { ingestClassifications } from '../db/schema/index.ts'
import type { Problem } from '../llm/batch.ts'
import { classifyKey, type ClassifyInput, type ClassifyResult } from './classifier.ts'

export interface StoredClassification {
  primary: string
  secondary: string[]
  confidence: number
  status: string
}

export class ClassificationStore {
  constructor(private readonly db: Db) {}

  /** 已分类条目的输入指纹和提示词版本 */
  async existing(inputs: ClassifyInput[]): Promise<Map<string, { inputHash: string; promptVersion: number }>> {
    const out = new Map<string, { inputHash: string; promptVersion: number }>()
    const groups = new Map<string, ClassifyInput[]>()
    for (const i of inputs) groups.set(`${i.sourceId}|${i.kind}`, [...(groups.get(`${i.sourceId}|${i.kind}`) ?? []), i])
    for (const [group, list] of groups) {
      const [sourceId, kind] = group.split('|') as [string, EntityKind]
      for (let i = 0; i < list.length; i += 1000) {
        const rows = await this.db
          .select({ externalId: ingestClassifications.externalId, inputHash: ingestClassifications.inputHash, promptVersion: ingestClassifications.promptVersion })
          .from(ingestClassifications)
          .where(and(eq(ingestClassifications.sourceId, sourceId), eq(ingestClassifications.kind, kind), inArray(ingestClassifications.externalId, list.slice(i, i + 1000).map((x) => x.externalId))))
        for (const row of rows) out.set(classifyKey({ sourceId, kind, externalId: row.externalId }), { inputHash: row.inputHash, promptVersion: row.promptVersion })
      }
    }
    return out
  }

  async save(input: ClassifyInput, result: ClassifyResult, problems: Problem[], meta: { model: string; promptVersion: number; taxonomyVersion: number }): Promise<void> {
    const values = {
      primarySlug: result.primary,
      secondary: result.secondary,
      confidence: result.confidence,
      taxonomyVersion: meta.taxonomyVersion,
      promptVersion: meta.promptVersion,
      inputHash: input.inputHash,
      model: meta.model,
      status: problems.length > 0 ? 'review' : 'ok',
      classifiedAt: new Date(),
    }
    await withDeadlockRetry(() =>
      this.db
        .insert(ingestClassifications)
        .values({ sourceId: input.sourceId, kind: input.kind, externalId: input.externalId, ...values })
        .onDuplicateKeyUpdate({ set: values }),
    )
  }

  /** 发布时用：全部分类结果，按 来源:类型:ID 索引 */
  async all(kinds: readonly EntityKind[]): Promise<Map<string, StoredClassification>> {
    const rows = await this.db
      .select({
        sourceId: ingestClassifications.sourceId,
        kind: ingestClassifications.kind,
        externalId: ingestClassifications.externalId,
        primary: ingestClassifications.primarySlug,
        secondary: ingestClassifications.secondary,
        confidence: ingestClassifications.confidence,
        status: ingestClassifications.status,
      })
      .from(ingestClassifications)
      .where(inArray(ingestClassifications.kind, [...kinds]))
    return new Map(rows.map((r) => [classifyKey(r), { primary: r.primary, secondary: r.secondary, confidence: r.confidence, status: r.status }]))
  }
}
