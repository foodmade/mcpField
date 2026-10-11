import { and, asc, eq, inArray } from 'drizzle-orm'
import { withDeadlockRetry } from '../db/retry.ts'
import { LOCALES, type EntityKind, type Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestOverviewItems, ingestOverviews } from '../db/schema/index.ts'
import type { Problem } from '../llm/batch.ts'
import { overviewKey, type OverviewContent, type OverviewInput, type OverviewResult, type OverviewWriter } from './types.ts'

export interface StoredOverview extends OverviewContent {
  locale: Locale
  status: string
  model: string | null
  generatedAt: Date
}

/** 按条目读取介绍：接口层只依赖这个接口 */
export interface OverviewReader {
  /** 取指定语言；没有时退回英文 */
  find(ref: { sourceId: string; kind: EntityKind; externalId: string }, locale: Locale): Promise<StoredOverview | null>
}

export class OverviewStore implements OverviewReader {
  constructor(private readonly db: Db) {}

  /** 已生成的条目：返回每个条目的输入指纹、提示词版本和已有语言数 */
  async existing(inputs: OverviewInput[]): Promise<Map<string, { inputHash: string; promptVersion: number; locales: number }>> {
    const out = new Map<string, { inputHash: string; promptVersion: number; locales: number }>()
    const byKind = new Map<string, OverviewInput[]>()
    for (const i of inputs) byKind.set(`${i.sourceId}|${i.kind}`, [...(byKind.get(`${i.sourceId}|${i.kind}`) ?? []), i])
    for (const [group, list] of byKind) {
      const [sourceId, kind] = group.split('|') as [string, EntityKind]
      for (let i = 0; i < list.length; i += 500) {
        const ids = list.slice(i, i + 500).map((x) => x.externalId)
        const rows = await this.db
          .select({ externalId: ingestOverviews.externalId, inputHash: ingestOverviews.inputHash, promptVersion: ingestOverviews.promptVersion })
          .from(ingestOverviews)
          .where(and(eq(ingestOverviews.sourceId, sourceId), eq(ingestOverviews.kind, kind), inArray(ingestOverviews.externalId, ids)))
        for (const row of rows) {
          const key = overviewKey({ sourceId, kind, externalId: row.externalId })
          const prev = out.get(key)
          // 三种语言的指纹或版本不一致时，取"最旧"的那个，保证会被重新生成
          out.set(key, {
            inputHash: prev && prev.inputHash !== row.inputHash ? '' : row.inputHash,
            promptVersion: Math.min(prev?.promptVersion ?? Infinity, row.promptVersion ?? 0),
            locales: (prev?.locales ?? 0) + 1,
          })
        }
      }
    }
    return out
  }

  async save(input: OverviewInput, result: OverviewResult, problems: Problem[], writer: Pick<OverviewWriter, 'provider' | 'model' | 'promptVersion'>): Promise<void> {
    await withDeadlockRetry(() => this.db.transaction(async (tx) => {
      for (const locale of LOCALES) {
        const content = result.content[locale]
        const localeProblems = problems.filter((p) => !p.locale || p.locale === locale)
        const values = {
          summary: content.summary,
          mcpNote: content.mcp || null,
          inputHash: input.inputHash,
          provider: writer.provider,
          model: writer.model,
          promptVersion: writer.promptVersion,
          status: localeProblems.length > 0 ? 'review' : 'ok',
          problems: localeProblems.length > 0 ? localeProblems : null,
          generatedAt: new Date(),
        }
        await tx
          .insert(ingestOverviews)
          .values({ sourceId: input.sourceId, kind: input.kind, externalId: input.externalId, locale, ...values })
          .onDuplicateKeyUpdate({ set: values })
        const [row] = await tx
          .select({ id: ingestOverviews.id })
          .from(ingestOverviews)
          .where(and(eq(ingestOverviews.sourceId, input.sourceId), eq(ingestOverviews.kind, input.kind), eq(ingestOverviews.externalId, input.externalId), eq(ingestOverviews.locale, locale)))

        await tx.delete(ingestOverviewItems).where(eq(ingestOverviewItems.overviewId, row!.id))
        const items = [
          ...content.features.map((text, position) => ({ overviewId: row!.id, list: 'feature', position, text: text.slice(0, 1024) })),
          ...content.useCases.map((text, position) => ({ overviewId: row!.id, list: 'use_case', position, text: text.slice(0, 1024) })),
        ]
        if (items.length > 0) await tx.insert(ingestOverviewItems).values(items)
      }
    }))
  }

  async find(ref: { sourceId: string; kind: EntityKind; externalId: string }, locale: Locale): Promise<StoredOverview | null> {
    const rows = await this.db
      .select()
      .from(ingestOverviews)
      .where(and(eq(ingestOverviews.sourceId, ref.sourceId), eq(ingestOverviews.kind, ref.kind), eq(ingestOverviews.externalId, ref.externalId), inArray(ingestOverviews.locale, [locale, 'en'])))
    const row = rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'en')
    if (!row) return null
    const items = await this.db
      .select({ list: ingestOverviewItems.list, text: ingestOverviewItems.text })
      .from(ingestOverviewItems)
      .where(eq(ingestOverviewItems.overviewId, row.id))
      .orderBy(asc(ingestOverviewItems.list), asc(ingestOverviewItems.position))
    return {
      locale: row.locale,
      summary: row.summary,
      features: items.filter((i) => i.list === 'feature').map((i) => i.text),
      useCases: items.filter((i) => i.list === 'use_case').map((i) => i.text),
      mcp: row.mcpNote ?? '',
      status: row.status,
      model: row.model,
      generatedAt: row.generatedAt,
    }
  }
}
