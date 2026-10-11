import { and, eq, inArray, ne } from 'drizzle-orm'
import { LOCALES, type Locale } from '../core/types.ts'
import { withDeadlockRetry } from '../db/retry.ts'
import type { Db } from '../db/client.ts'
import { ingestTranslationSources, ingestTranslations } from '../db/schema/index.ts'
import { normalizeSource } from './key.ts'
import type { TranslationItem, TranslationResult, Translator } from './types.ts'
import type { ValidationProblem } from './validate.ts'

const CHUNK = 500

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** 按原文指纹读取译文：接口层只依赖这个接口 */
export interface TranslationReader {
  lookup(hashes: string[], locale: Locale): Promise<Map<string, string>>
}

/** 翻译记忆库：原文按指纹去重，每种语言一行；人工修改过的译文不会被自动翻译覆盖 */
export class TranslationMemory implements TranslationReader {
  constructor(private readonly db: Db) {}

  /**
   * 已经有完整三语结果的原文指纹。
   * minPromptVersion > 0 时，旧版提示词翻出来的结果不算完成（人工译文永远算完成）。
   */
  async completed(hashes: string[], minPromptVersion = 0): Promise<Set<string>> {
    const ok = new Map<string, number>()
    for (const part of chunks(hashes)) {
      const rows = await this.db
        .select({ hash: ingestTranslations.sourceHash, origin: ingestTranslations.origin, version: ingestTranslations.promptVersion })
        .from(ingestTranslations)
        .where(inArray(ingestTranslations.sourceHash, part))
      for (const row of rows) {
        if (row.origin === 'manual' || (row.version ?? 0) >= minPromptVersion) ok.set(row.hash, (ok.get(row.hash) ?? 0) + 1)
      }
    }
    return new Set([...ok].filter(([, n]) => n >= LOCALES.length).map(([hash]) => hash))
  }

  async save(item: TranslationItem, result: TranslationResult, problems: ValidationProblem[], translator: Translator): Promise<void> {
    const text = normalizeSource(item.text)
    await withDeadlockRetry(() => this.db.transaction(async (tx) => {
      await tx
        .insert(ingestTranslationSources)
        .values({ hash: item.hash, text, charCount: text.length, sourceLocale: result.sourceLocale, createdAt: new Date() })
        .onDuplicateKeyUpdate({ set: { sourceLocale: result.sourceLocale } })

      const manual = await tx
        .select({ locale: ingestTranslations.locale })
        .from(ingestTranslations)
        .where(and(eq(ingestTranslations.sourceHash, item.hash), eq(ingestTranslations.origin, 'manual')))
      const skip = new Set(manual.map((m) => m.locale))

      for (const locale of LOCALES) {
        if (skip.has(locale)) continue
        const localeProblems = problems.filter((p) => !p.locale || p.locale === locale)
        const values = {
          content: result.texts[locale],
          origin: result.sourceLocale === locale ? 'source' : 'translated',
          status: localeProblems.length > 0 ? 'review' : 'ok',
          problems: localeProblems.length > 0 ? localeProblems : null,
          provider: translator.provider,
          model: translator.model,
          promptVersion: translator.promptVersion,
        }
        await tx
          .insert(ingestTranslations)
          .values({ sourceHash: item.hash, locale, ...values })
          .onDuplicateKeyUpdate({ set: values })
      }
    }))
  }

  /** 单语言写入：README 片段每次只翻一种语言；人工译文不覆盖 */
  async saveSingle(
    source: { hash: string; text: string },
    locale: Locale,
    content: string,
    problems: ValidationProblem[],
    meta: { provider: string; model: string; promptVersion: number },
  ): Promise<void> {
    await withDeadlockRetry(() => this.db.transaction(async (tx) => {
      await tx
        .insert(ingestTranslationSources)
        .values({ hash: source.hash, text: source.text, charCount: source.text.length, sourceLocale: 'en', createdAt: new Date() })
        .onDuplicateKeyUpdate({ set: { charCount: source.text.length } })
      const [manual] = await tx
        .select({ id: ingestTranslations.id })
        .from(ingestTranslations)
        .where(and(eq(ingestTranslations.sourceHash, source.hash), eq(ingestTranslations.locale, locale), eq(ingestTranslations.origin, 'manual')))
      if (manual) return
      const values = {
        content,
        origin: 'translated',
        status: problems.length > 0 ? 'review' : 'ok',
        problems: problems.length > 0 ? problems : null,
        ...meta,
      }
      await tx.insert(ingestTranslations).values({ sourceHash: source.hash, locale, ...values }).onDuplicateKeyUpdate({ set: values })
    }))
  }

  /** 带状态和版本的查询，用于拼装 README 译文和判断是否需要重翻 */
  async lookupDetailed(hashes: string[], locale: Locale): Promise<Map<string, { content: string; status: string; model: string | null; promptVersion: number; origin: string }>> {
    const map = new Map<string, { content: string; status: string; model: string | null; promptVersion: number; origin: string }>()
    for (const part of chunks([...new Set(hashes)])) {
      const rows = await this.db
        .select({
          hash: ingestTranslations.sourceHash,
          content: ingestTranslations.content,
          status: ingestTranslations.status,
          model: ingestTranslations.model,
          promptVersion: ingestTranslations.promptVersion,
          origin: ingestTranslations.origin,
        })
        .from(ingestTranslations)
        .where(and(inArray(ingestTranslations.sourceHash, part), eq(ingestTranslations.locale, locale)))
      for (const row of rows) map.set(row.hash, { content: row.content, status: row.status, model: row.model, promptVersion: row.promptVersion ?? 0, origin: row.origin })
    }
    return map
  }

  /** 按当前规则更新已有译文的校验状态（不改内容，跳过人工译文） */
  async restatus(hash: string, problems: ValidationProblem[]): Promise<void> {
    for (const locale of LOCALES) {
      const localeProblems = problems.filter((p) => !p.locale || p.locale === locale)
      await this.db
        .update(ingestTranslations)
        .set({ status: localeProblems.length > 0 ? 'review' : 'ok', problems: localeProblems.length > 0 ? localeProblems : null })
        .where(and(eq(ingestTranslations.sourceHash, hash), eq(ingestTranslations.locale, locale), ne(ingestTranslations.origin, 'manual')))
    }
  }

  /** 读出已保存的三语结果（用于按当前规则重新校验） */
  async loadResults(hashes: string[]): Promise<Map<string, TranslationResult & { manual: Set<Locale> }>> {
    const out = new Map<string, TranslationResult & { manual: Set<Locale> }>()
    for (const part of chunks(hashes)) {
      const rows = await this.db
        .select({
          hash: ingestTranslations.sourceHash,
          locale: ingestTranslations.locale,
          content: ingestTranslations.content,
          origin: ingestTranslations.origin,
          sourceLocale: ingestTranslationSources.sourceLocale,
        })
        .from(ingestTranslations)
        .innerJoin(ingestTranslationSources, eq(ingestTranslationSources.hash, ingestTranslations.sourceHash))
        .where(inArray(ingestTranslations.sourceHash, part))
      for (const row of rows) {
        const entry = out.get(row.hash) ?? { hash: row.hash, sourceLocale: (row.sourceLocale ?? 'other') as TranslationResult['sourceLocale'], texts: { zh: '', en: '', ja: '' }, manual: new Set<Locale>() }
        entry.texts[row.locale as Locale] = row.content
        if (row.origin === 'manual') entry.manual.add(row.locale as Locale)
        out.set(row.hash, entry)
      }
    }
    return out
  }

  async lookup(hashes: string[], locale: Locale): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const part of chunks([...new Set(hashes)])) {
      const rows = await this.db
        .select({ hash: ingestTranslations.sourceHash, content: ingestTranslations.content })
        .from(ingestTranslations)
        .where(and(inArray(ingestTranslations.sourceHash, part), eq(ingestTranslations.locale, locale)))
      for (const row of rows) map.set(row.hash, row.content)
    }
    return map
  }
}
