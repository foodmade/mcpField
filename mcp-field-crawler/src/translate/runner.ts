import { sql } from 'drizzle-orm'
import type { TextField } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { runBatches, type BatchJob, type BatchStats } from '../llm/batch.ts'
import { normalizeSource, sourceHash } from './key.ts'
import type { TranslationMemory } from './memory.ts'
import type { TranslationItem, TranslationResult, Translator } from './types.ts'
import { isHardFailure, validateTranslation } from './validate.ts'

export interface TranslateOptions {
  /** 每次请求最多多少条 */
  batchSize: number
  /** 每次请求的原文总字符数上限 */
  maxBatchChars: number
  concurrency: number
  limit?: number
  /** 旧版提示词的结果也重翻 */
  stale?: boolean
  /** 忽略已有结果，全部重翻（人工译文仍然保留） */
  force?: boolean
  /** 按当前校验规则重新检查已有译文，不合格的重翻 */
  recheck?: boolean
  signal?: AbortSignal
}

export type TranslateStats = Omit<BatchStats, 'total'> & { sources: number; pending: number }

/** 从草稿里收集要翻译的文本，按原文指纹去重 */
export async function collectSources(db: Db, kinds: readonly EntityKind[], fields: readonly TextField[]): Promise<TranslationItem[]> {
  const [rows] = (await db.execute(sql`
    SELECT d.kind, JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.name')) AS name, t.content
    FROM ingest_drafts d,
         JSON_TABLE(d.draft, '$.texts[*]' COLUMNS (field VARCHAR(24) PATH '$.field', content LONGTEXT PATH '$.content')) t
    WHERE d.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      AND t.field IN (${sql.join(fields.map((f) => sql`${f}`), sql`, `)})
    ORDER BY d.id`)) as unknown as [{ kind: EntityKind; name: string; content: string }[]]

  const items = new Map<string, TranslationItem>()
  for (const row of rows) {
    const text = normalizeSource(row.content ?? '')
    if (!text) continue
    const hash = sourceHash(text)
    if (!items.has(hash)) items.set(hash, { hash, text, name: row.name, kind: row.kind })
  }
  return [...items.values()]
}

/**
 * 批量翻译：跳过已完成的原文 → 交给通用批处理（分批、并发、校验、重试）→ 写入翻译记忆库。
 */
export class TranslateRunner {
  constructor(
    private readonly translator: Translator,
    private readonly memory: Pick<TranslationMemory, 'completed' | 'save' | 'loadResults' | 'restatus'>,
    private readonly logger: Logger,
  ) {}

  async run(items: TranslationItem[], options: TranslateOptions): Promise<TranslateStats> {
    const completed = options.force ? new Set<string>() : await this.memory.completed(items.map((i) => i.hash), options.stale ? this.translator.promptVersion : 0)
    if (options.recheck && completed.size > 0) await this.recheck(items, completed)

    let pending = items.filter((i) => !completed.has(i.hash))
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)
    this.logger.info({ sources: items.length, done: completed.size, pending: pending.length, model: this.translator.model }, '开始翻译')

    const job: BatchJob<TranslationItem, TranslationResult> = {
      key: (item) => item.hash,
      size: (item) => item.text.length,
      call: async (batch, signal) => {
        const { results, usage } = await this.translator.translate(batch, signal)
        return { results: new Map(results.map((r) => [r.hash, r])), usage }
      },
      validate: validateTranslation,
      save: (item, result, problems) => this.memory.save(item, result, problems, this.translator),
      describe: (item) => item.text.slice(0, 80),
    }
    const { total: _total, ...stats } = await runBatches(pending, job, options, this.logger)
    return { sources: items.length, pending: pending.length, ...stats }
  }

  /** 按当前规则重新校验已有译文：不合格的移出"已完成"重新翻译，其余刷新校验状态 */
  private async recheck(items: TranslationItem[], completed: Set<string>): Promise<void> {
    const stored = await this.memory.loadResults([...completed])
    let rejected = 0
    for (const item of items) {
      const result = stored.get(item.hash)
      if (!result || result.manual.size > 0) continue
      const problems = validateTranslation(item, result)
      if (isHardFailure(problems)) {
        completed.delete(item.hash)
        rejected++
      } else {
        await this.memory.restatus(item.hash, problems)
      }
    }
    this.logger.info({ checked: stored.size, rejected }, '已按当前规则重新校验')
  }
}
