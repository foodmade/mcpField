import { and, eq, inArray } from 'drizzle-orm'
import type { EntityKind, Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestReadmeTranslations } from '../db/schema/index.ts'

export interface ReadmeTarget {
  sourceId: string
  kind: EntityKind
  externalId: string
  name: string
  license: string | null
  readme: string
  readmeHash: string
  stars: number | null
}

export interface StoredReadmeTranslation {
  locale: Locale
  readmeHash: string
  content: string
  status: string
  models: string | null
  license: string | null
  translatedAt: Date
}

export const targetKey = (t: Pick<ReadmeTarget, 'sourceId' | 'kind' | 'externalId'>) => `${t.sourceId}:${t.kind}:${t.externalId}`

/** 按条目读取 README 译文：接口层只依赖这个接口 */
export interface ReadmeTranslationReader {
  find(ref: { sourceId: string; kind: EntityKind; externalId: string }, locale: Locale): Promise<StoredReadmeTranslation | null>
}

export class ReadmeTranslationStore implements ReadmeTranslationReader {
  constructor(private readonly db: Db) {}

  /** 已有的整篇译文：key → 语言 → { 原文指纹, 提示词版本 } */
  async existing(targets: ReadmeTarget[]): Promise<Map<string, Map<string, { readmeHash: string; promptVersion: number }>>> {
    const out = new Map<string, Map<string, { readmeHash: string; promptVersion: number }>>()
    const groups = new Map<string, ReadmeTarget[]>()
    for (const t of targets) groups.set(`${t.sourceId}|${t.kind}`, [...(groups.get(`${t.sourceId}|${t.kind}`) ?? []), t])
    for (const [group, list] of groups) {
      const [sourceId, kind] = group.split('|') as [string, EntityKind]
      for (let i = 0; i < list.length; i += 500) {
        const rows = await this.db
          .select({ externalId: ingestReadmeTranslations.externalId, locale: ingestReadmeTranslations.locale, readmeHash: ingestReadmeTranslations.readmeHash, promptVersion: ingestReadmeTranslations.promptVersion })
          .from(ingestReadmeTranslations)
          .where(and(eq(ingestReadmeTranslations.sourceId, sourceId), eq(ingestReadmeTranslations.kind, kind), inArray(ingestReadmeTranslations.externalId, list.slice(i, i + 500).map((t) => t.externalId))))
        for (const row of rows) {
          const key = targetKey({ sourceId, kind, externalId: row.externalId })
          const byLocale = out.get(key) ?? new Map()
          byLocale.set(row.locale, { readmeHash: row.readmeHash, promptVersion: row.promptVersion ?? 0 })
          out.set(key, byLocale)
        }
      }
    }
    return out
  }

  async save(
    target: ReadmeTarget,
    locale: Locale,
    data: { content: string; chunkCount: number; translatedChunks: number; reviewChunks: number; models: string[]; promptVersion: number },
  ): Promise<void> {
    const values = {
      readmeHash: target.readmeHash,
      content: data.content,
      chunkCount: data.chunkCount,
      translatedChunks: data.translatedChunks,
      reviewChunks: data.reviewChunks,
      models: data.models.join(',').slice(0, 255) || null,
      promptVersion: data.promptVersion,
      status: data.reviewChunks > 0 ? 'review' : 'ok',
      license: target.license?.slice(0, 64) ?? null,
      translatedAt: new Date(),
    }
    await this.db
      .insert(ingestReadmeTranslations)
      .values({ sourceId: target.sourceId, kind: target.kind, externalId: target.externalId, locale, ...values })
      .onDuplicateKeyUpdate({ set: values })
  }

  async find(ref: { sourceId: string; kind: EntityKind; externalId: string }, locale: Locale): Promise<StoredReadmeTranslation | null> {
    const [row] = await this.db
      .select()
      .from(ingestReadmeTranslations)
      .where(and(eq(ingestReadmeTranslations.sourceId, ref.sourceId), eq(ingestReadmeTranslations.kind, ref.kind), eq(ingestReadmeTranslations.externalId, ref.externalId), eq(ingestReadmeTranslations.locale, locale)))
    if (!row) return null
    return { locale: row.locale, readmeHash: row.readmeHash, content: row.content, status: row.status, models: row.models, license: row.license, translatedAt: row.translatedAt }
  }
}
