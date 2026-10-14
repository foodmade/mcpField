import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { ingestTranslationFailures } from '../db/schema/index.ts'

const CHUNK = 500

/** 翻译失败记录：内容上多次重做仍不合格的片段，见 ingestTranslationFailures */
export class TranslationFailures {
  constructor(private readonly db: Db) {}

  /** 失败过的原文指纹 */
  async lookup(hashes: string[], locale: string): Promise<Set<string>> {
    const failed = new Set<string>()
    const unique = [...new Set(hashes)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await this.db
        .select({ hash: ingestTranslationFailures.sourceHash })
        .from(ingestTranslationFailures)
        .where(and(inArray(ingestTranslationFailures.sourceHash, unique.slice(i, i + CHUNK)), eq(ingestTranslationFailures.locale, locale)))
      for (const row of rows) failed.add(row.hash)
    }
    return failed
  }

  async record(hash: string, locale: string, reason: string, model: string): Promise<void> {
    await this.db
      .insert(ingestTranslationFailures)
      .values({ sourceHash: hash, locale, reason: reason.slice(0, 255), model })
      .onDuplicateKeyUpdate({ set: { failures: sql`${ingestTranslationFailures.failures} + 1`, reason: reason.slice(0, 255), model } })
  }
}
