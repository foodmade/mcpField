import { and, asc, gt, inArray } from 'drizzle-orm'
import type { EntityDraft } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestDrafts } from '../db/schema/index.ts'
import { runBatches, type BatchJob } from '../llm/batch.ts'
import type { TranslationMemory } from '../translate/memory.ts'
import { prepareReadmeChunks, readmeHash, restoreCode, textLocale, type ReadmeChunk } from './chunk.ts'
import type { ReadmeLocale } from './prompt.ts'
import { targetKey, type ReadmeTarget, type ReadmeTranslationStore } from './store.ts'
import type { ReadmeTranslator } from './translator.ts'
import { validateReadmeChunk } from './validate.ts'

/** 明确的开源许可证 */
const OPEN_LICENSE = /\b(MIT|Apache|GPL|LGPL|AGPL|MPL|BSD|ISC|Unlicense|CC0|EPL|Zlib|0BSD|Artistic)\b/i

/** 分页读取草稿，收集有 README 的条目 */
export async function collectReadmeTargets(db: Db, kinds: readonly EntityKind[], options: { minStars?: number; licensedOnly?: boolean } = {}): Promise<{ targets: ReadmeTarget[]; skipped: number }> {
  const targets: ReadmeTarget[] = []
  let skipped = 0
  let lastId = 0
  for (;;) {
    const rows = await db
      .select({ id: ingestDrafts.id, draft: ingestDrafts.draft })
      .from(ingestDrafts)
      .where(and(inArray(ingestDrafts.kind, [...kinds]), gt(ingestDrafts.id, lastId)))
      .orderBy(asc(ingestDrafts.id))
      .limit(200)
    if (rows.length === 0) break
    for (const row of rows) {
      const d = row.draft as EntityDraft
      const readme = d.texts.find((t) => t.field === 'readme')?.content?.trim()
      const stars = d.metrics.find((m) => m.metric === 'github_stars')?.value ?? null
      const license = d.license ?? null
      // 源站偶尔把整个网页当成 README 收录（<!DOCTYPE html>…），这种内容不翻译
      const htmlPage = !!readme && /^\s*<!doctype html|^\s*<html[\s>]/i.test(readme)
      if (!readme || htmlPage || (stars ?? 0) < (options.minStars ?? 0) || (options.licensedOnly && !(license && OPEN_LICENSE.test(license)))) {
        skipped++
        continue
      }
      targets.push({ sourceId: d.sourceId, kind: d.kind, externalId: d.externalId, name: d.name, license, readme, readmeHash: readmeHash(readme), stars })
    }
    lastId = rows.at(-1)!.id
  }
  return { targets, skipped }
}

interface ChunkWork {
  hash: string
  text: string
  locale: ReadmeLocale
  premium: boolean
}

export interface ReadmeOptions {
  locales: ReadmeLocale[]
  concurrency: number
  maxChunkChars?: number
  limit?: number
  /** 旧版提示词翻译的片段也重翻 */
  stale?: boolean
  /** 忽略已有结果全部重翻（人工译文保留） */
  force?: boolean
  signal?: AbortSignal
}

export interface ReadmeStats {
  targets: number
  pending: number
  chunks: number
  /** 需要调用模型翻译的片段（已按内容去重） */
  work: number
  ok: number
  review: number
  failed: number
  /** 拼装成功的整篇译文数（条目 × 语言） */
  assembled: number
  /** README 本身就是目标语言，不需要译文 */
  sameLanguage: number
  incomplete: number
  requests: number
  inputTokens: number
  outputTokens: number
  seconds: number
}

/** 按热度选模型：星数达到门槛的用更强的模型 */
export interface ReadmeRouting {
  standard: ReadmeTranslator
  premium?: ReadmeTranslator
  premiumMinStars: number
}

type ChunkMemory = Pick<TranslationMemory, 'lookupDetailed' | 'saveSingle'>

/**
 * README 整篇翻译：
 * 代码块占位 + 按章节切片 → 片段按内容去重，翻译记忆库里已有的跳过 → 按模型分组批量翻译（每次一个片段）
 * → 逐段校验（占位符、链接、语言等）→ 写入翻译记忆库 → 拼回整篇、还原代码块 → 存整篇译文
 */
export class ReadmeTranslateRunner {
  constructor(
    private readonly routing: ReadmeRouting,
    private readonly memory: ChunkMemory,
    private readonly store: Pick<ReadmeTranslationStore, 'existing' | 'save'>,
    private readonly logger: Logger,
  ) {}

  async run(targets: ReadmeTarget[], options: ReadmeOptions): Promise<ReadmeStats> {
    const started = Date.now()
    const version = this.routing.standard.promptVersion
    const existing = options.force ? new Map() : await this.store.existing(targets)
    let pending = targets.filter((t) =>
      options.locales.some((locale) => {
        const prev = existing.get(targetKey(t))?.get(locale)
        return !prev || prev.readmeHash !== t.readmeHash || (options.stale && prev.promptVersion < version)
      }),
    )
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)

    const prepared = pending.map((target) => ({ target, ...prepareReadmeChunks(target.readme, options.maxChunkChars) }))
    const isPremium = (t: ReadmeTarget) => !!this.routing.premium && (t.stars ?? 0) >= this.routing.premiumMinStars

    // 找出需要翻译的片段：按 内容指纹 × 语言 去重
    const work = new Map<string, ChunkWork>()
    for (const locale of options.locales) {
      const hashes = prepared.flatMap((p) => p.chunks.filter((c) => c.prose).map((c) => c.hash))
      const known = await this.memory.lookupDetailed(hashes, locale)
      for (const p of prepared) {
        for (const chunk of p.chunks) {
          // 已经是目标语言的片段（例如本来就是中文写的 README）直接沿用原文
          if (!chunk.prose || textLocale(chunk.text) === locale) continue
          const prev = known.get(chunk.hash)
          const redo = !prev || (prev.origin !== 'manual' && (options.force || (options.stale && prev.promptVersion < version)))
          if (!redo) continue
          const key = `${chunk.hash}:${locale}`
          work.set(key, { hash: chunk.hash, text: chunk.text, locale, premium: (work.get(key)?.premium ?? false) || isPremium(p.target) })
        }
      }
    }

    const stats: ReadmeStats = {
      targets: targets.length,
      pending: pending.length,
      chunks: prepared.reduce((n, p) => n + p.chunks.length, 0),
      work: work.size,
      ok: 0,
      review: 0,
      failed: 0,
      assembled: 0,
      sameLanguage: 0,
      incomplete: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
    }
    const items = [...work.values()]
    const groups: [ReadmeTranslator, ChunkWork[]][] = [
      [this.routing.standard, items.filter((w) => !w.premium || !this.routing.premium)],
      ...(this.routing.premium ? [[this.routing.premium, items.filter((w) => w.premium)] as [ReadmeTranslator, ChunkWork[]]] : []),
    ]
    this.logger.info({ targets: targets.length, pending: pending.length, chunks: stats.chunks, work: items.length, groups: groups.map(([t, list]) => `${t.model}: ${list.length}`) }, '开始翻译 README')

    for (const [translator, list] of groups) {
      if (list.length === 0) continue
      const job: BatchJob<ChunkWork, string> = {
        key: (w) => `${w.hash}:${w.locale}`,
        size: (w) => w.text.length,
        call: async ([w], signal) => {
          const { text, usage } = await translator.translate(w!.text, w!.locale, signal)
          return { results: new Map([[`${w!.hash}:${w!.locale}`, text]]), usage }
        },
        validate: (w, text) => validateReadmeChunk(w.text, text, w.locale),
        save: (w, text, problems) => this.memory.saveSingle({ hash: w.hash, text: w.text }, w.locale, text, problems, translator),
        describe: (w) => `${w.locale} ${w.text.slice(0, 60).replace(/\n/g, ' ')}`,
      }
      const s = await runBatches(list, job, { batchSize: 1, maxBatchChars: Number.MAX_SAFE_INTEGER, concurrency: options.concurrency, retryBatchSize: 1, signal: options.signal }, this.logger)
      for (const k of ['ok', 'review', 'failed', 'requests', 'inputTokens', 'outputTokens'] as const) stats[k] += s[k]
    }

    // 拼装整篇：所有正文片段都有译文才保存
    for (const locale of options.locales) {
      const known = await this.memory.lookupDetailed(prepared.flatMap((p) => p.chunks.filter((c) => c.prose).map((c) => c.hash)), locale)
      for (const p of prepared) {
        const assembled = this.assemble(p.chunks, p.codeBlocks, known, locale)
        if (!assembled) {
          stats.incomplete++
          continue
        }
        if (assembled.translatedChunks === 0) {
          stats.sameLanguage++
          continue
        }
        await this.store.save(p.target, locale, { ...assembled, chunkCount: p.chunks.length, promptVersion: version })
        stats.assembled++
      }
    }
    stats.seconds = Math.round((Date.now() - started) / 1000)
    return stats
  }

  private assemble(chunks: ReadmeChunk[], codeBlocks: string[], known: Map<string, { content: string; status: string; model: string | null }>, locale: ReadmeLocale) {
    const parts: string[] = []
    const models = new Set<string>()
    let translatedChunks = 0
    let reviewChunks = 0
    for (const chunk of chunks) {
      if (!chunk.prose || textLocale(chunk.text) === locale) {
        parts.push(chunk.text)
        continue
      }
      const t = known.get(chunk.hash)
      if (!t) return null
      parts.push(t.content)
      translatedChunks++
      if (t.status === 'review') reviewChunks++
      if (t.model) models.add(t.model)
    }
    return { content: restoreCode(parts.join('\n'), codeBlocks), translatedChunks, reviewChunks, models: [...models] }
  }
}
