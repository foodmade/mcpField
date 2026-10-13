import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { runBatches, type BatchJob } from '../llm/batch.ts'
import type { TranslationMemory } from '../translate/memory.ts'
import { prepareReadmeChunks, readmeHash, restoreCode, textLocale, type ReadmeChunk } from './chunk.ts'
import type { ReadmeLocale } from './prompt.ts'
import { draftsWithReadme } from './source.ts'
import { targetKey, type ReadmeTarget, type ReadmeTranslationStore } from './store.ts'
import type { ReadmeTranslator } from './translator.ts'
import { validateReadmeChunk } from './validate.ts'

/** 明确的开源许可证 */
const OPEN_LICENSE = /\b(MIT|Apache|GPL|LGPL|AGPL|MPL|BSD|ISC|Unlicense|CC0|EPL|Zlib|0BSD|Artistic)\b/i

/** 分页读取草稿，收集有 GitHub README 的条目；按星数从高到低排，热门条目先翻译 */
export async function collectReadmeTargets(db: Db, kinds: readonly EntityKind[], options: { minStars?: number; licensedOnly?: boolean } = {}): Promise<{ targets: ReadmeTarget[]; skipped: number }> {
  const targets: ReadmeTarget[] = []
  let skipped = 0
  for await (const { draft: d, readme: resolved, stars } of draftsWithReadme(db, kinds)) {
    const readme = resolved?.content.trim()
    const license = d.license ?? null
    // 纯文本格式（.rst 等）的 README 不翻译
    if (!resolved || !readme || resolved.format !== 'markdown' || (stars ?? 0) < (options.minStars ?? 0) || (options.licensedOnly && !(license && OPEN_LICENSE.test(license)))) {
      skipped++
      continue
    }
    targets.push({ sourceId: d.sourceId, kind: d.kind, externalId: d.externalId, name: d.name, license, readme, readmeHash: readmeHash(readme), stars })
  }
  targets.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
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
  /** 每片处理的 README 数，默认 2,000 */
  sliceSize?: number
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
  /** 热门档模型被限流、改用普通档翻译的片段数 */
  premiumFallback: number
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
 * 热门档模型被限流（429，多半是订阅额度用完）后暂停多久再试，期间热门片段改用普通档模型。
 * 额度按时间窗恢复（OpenCode Go 每 5 小时一个窗口），暂停到期后再试一次，仍被限流就继续暂停
 */
const PREMIUM_PAUSE_MS = 15 * 60_000

const isRateLimited = (error: unknown) => (error as { status?: number } | null)?.status === 429

/**
 * README 整篇翻译：
 * 代码块占位 + 按章节切片 → 片段按内容去重，翻译记忆库里已有的跳过 → 按模型分组批量翻译（每次一个片段）
 * → 逐段校验（占位符、链接、语言等）→ 写入翻译记忆库 → 拼回整篇、还原代码块 → 存整篇译文
 */
export class ReadmeTranslateRunner {
  private premiumPausedUntil = 0

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

    const stats: ReadmeStats = {
      targets: targets.length,
      pending: pending.length,
      chunks: 0,
      work: 0,
      ok: 0,
      review: 0,
      failed: 0,
      assembled: 0,
      sameLanguage: 0,
      incomplete: 0,
      premiumFallback: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
    }
    // 分片处理：一次只把一片 README 切段、翻译、拼装，处理完释放（2026-10 导入 SKILL.md 后共 12 万篇，一次性处理会内存溢出）。
    // 目标已按星数从高到低排好，热门的先完成；相同段落跨片也只翻一次（译文都在翻译记忆库里）
    const size = options.sliceSize ?? 2_000
    for (let i = 0; i < pending.length && !options.signal?.aborted; i += size) {
      await this.runSlice(pending.slice(i, i + size), options, stats, version, `${i / size + 1}/${Math.ceil(pending.length / size)}`)
    }
    stats.seconds = Math.round((Date.now() - started) / 1000)
    return stats
  }

  /** 处理一片 README：切段 → 找出要翻译的片段 → 翻译 → 拼装整篇保存 */
  private async runSlice(pending: ReadmeTarget[], options: ReadmeOptions, stats: ReadmeStats, version: number, label: string): Promise<void> {
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

    stats.chunks += prepared.reduce((n, p) => n + p.chunks.length, 0)
    stats.work += work.size
    const items = [...work.values()]
    const groups: [ReadmeTranslator, ChunkWork[]][] = [
      [this.routing.standard, items.filter((w) => !w.premium || !this.routing.premium)],
      ...(this.routing.premium ? [[this.routing.premium, items.filter((w) => w.premium)] as [ReadmeTranslator, ChunkWork[]]] : []),
    ]
    this.logger.info({ slice: label, targets: pending.length, chunks: stats.chunks, work: items.length, groups: groups.map(([t, list]) => `${t.model}: ${list.length}`) }, '开始翻译 README')

    for (const [translator, list] of groups) {
      if (list.length === 0) continue
      // 每个片段实际用的模型（热门档被限流时改用普通档），保存时记到译文上
      const usedBy = new Map<string, ReadmeTranslator>()
      const job: BatchJob<ChunkWork, string> = {
        key: (w) => `${w.hash}:${w.locale}`,
        size: (w) => w.text.length,
        call: async ([w], signal) => {
          const key = `${w!.hash}:${w!.locale}`
          const { text, usage, used } = await this.translateWithFallback(translator, w!, stats, signal)
          usedBy.set(key, used)
          return { results: new Map([[key, text]]), usage }
        },
        validate: (w, text) => validateReadmeChunk(w.text, text, w.locale),
        save: (w, text, problems) => this.memory.saveSingle({ hash: w.hash, text: w.text }, w.locale, text, problems, usedBy.get(`${w.hash}:${w.locale}`) ?? translator),
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
  }

  /** 热门档模型被限流时改用普通档，并暂停热门档一段时间 */
  private async translateWithFallback(translator: ReadmeTranslator, w: ChunkWork, stats: ReadmeStats, signal?: AbortSignal) {
    const { standard } = this.routing
    const premium = translator !== standard
    if (!premium || Date.now() >= this.premiumPausedUntil) {
      try {
        return { ...(await translator.translate(w.text, w.locale, signal)), used: translator }
      } catch (error) {
        if (!premium || !isRateLimited(error)) throw error
        // 并发的请求会同时被拒，只在开始暂停时记一次
        if (Date.now() >= this.premiumPausedUntil) {
          this.logger.warn({ model: translator.model, fallback: standard.model, minutes: PREMIUM_PAUSE_MS / 60_000 }, '热门档模型被限流（可能额度用完），暂停期间改用普通档')
        }
        this.premiumPausedUntil = Date.now() + PREMIUM_PAUSE_MS
      }
    }
    stats.premiumFallback++
    return { ...(await standard.translate(w.text, w.locale, signal)), used: standard }
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
