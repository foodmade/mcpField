import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { readmeSubject } from '../github/readme.ts'
import type { GithubReadmeReader } from '../github/store.ts'
import { runBatches, type BatchJob } from '../llm/batch.ts'
import type { TranslationFailures } from '../translate/failures.ts'
import type { TranslationMemory } from '../translate/memory.ts'
import { prepareReadmeChunks, readmeHash, restoreCode, textLocale, type ReadmeChunk } from './chunk.ts'
import type { ReadmeLocale } from './prompt.ts'
import { draftsWithReadme, resolveReadme } from './source.ts'
import { targetKey, type ReadmeTarget, type ReadmeTranslationStore } from './store.ts'
import type { ReadmeTranslator } from './translator.ts'
import { validateReadmeChunk } from './validate.ts'

/** 明确的开源许可证 */
const OPEN_LICENSE = /\b(MIT|Apache|GPL|LGPL|AGPL|MPL|BSD|ISC|Unlicense|CC0|EPL|Zlib|0BSD|Artistic)\b/i

/**
 * 分页读取草稿，收集有 GitHub README 的条目；按星数从高到低排，热门条目先翻译。
 * 只记 README 的指纹和记录键，不留正文（12 万篇放进内存约 2GB，小内存的服务器会堆溢出），正文由 loadReadmes 按片读取
 */
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
    targets.push({ sourceId: d.sourceId, kind: d.kind, externalId: d.externalId, name: d.name, license, readmeKey: readmeSubject(d)?.key, readmeHash: readmeHash(readme), stars })
  }
  targets.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
  return { targets, skipped }
}

/** 读出一片目标的 README 正文（收集时只留了指纹）；收集之后 README 又更新过的，指纹跟着换成新的 */
export async function loadReadmes(reader: GithubReadmeReader, targets: ReadmeTarget[]): Promise<void> {
  const found = await reader.find(targets.flatMap((t) => (t.readmeKey ? [t.readmeKey] : [])))
  for (const t of targets) {
    const readme = resolveReadme(t.readmeKey ? found.get(t.readmeKey) : undefined)?.content.trim()
    if (!readme) continue
    t.readme = readme
    t.readmeHash = readmeHash(readme)
  }
}

type LoadedTarget = ReadmeTarget & { readme: string }

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
  /** 也翻之前内容上多次失败过的片段（默认跳过，见 ingestTranslationFailures）；整个任务跑完后用它专门补跑 */
  retryFailed?: boolean
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
  /** 模型被限流、改用下一个模型（热门档 → 普通档 → 后备模型）翻译的片段数 */
  fallback: number
  /** 之前内容上多次失败过、这次跳过的片段数（retryFailed 时不跳过） */
  deferred: number
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
  /** 后备模型：普通档（或热门档）被限流时改用它，可以是另一个模型服务 */
  fallback?: ReadmeTranslator
}

type ChunkMemory = Pick<TranslationMemory, 'lookupDetailed' | 'saveSingle'>

/**
 * 模型被限流（429）后暂停，期间改用下一个模型（热门档 → 普通档 → 后备模型）。暂停到期后再试，仍被限流就加倍暂停，最长 15 分钟；
 * 恢复后重新从 1 分钟算。高并发下的瞬时限流（例如 DeepSeek 上游的每分钟限额）只切走一会儿，订阅额度用完（按 5 小时窗口恢复）则稳定切走
 */
const PAUSE_MIN_MS = 60_000
const PAUSE_MAX_MS = 15 * 60_000

const isRateLimited = (error: unknown) => (error as { status?: number } | null)?.status === 429

/**
 * README 整篇翻译：
 * 代码块占位 + 按章节切片 → 片段按内容去重，翻译记忆库里已有的跳过 → 按模型分组批量翻译（每次一个片段）
 * → 逐段校验（占位符、链接、语言等）→ 写入翻译记忆库 → 拼回整篇、还原代码块 → 存整篇译文
 */
export class ReadmeTranslateRunner {
  /** 被限流而暂停的模型：到 until 再试，ms 是这次暂停的时长（再被限流时加倍） */
  private readonly paused = new Map<ReadmeTranslator, { until: number; ms: number }>()

  constructor(
    private readonly routing: ReadmeRouting,
    private readonly memory: ChunkMemory,
    private readonly store: Pick<ReadmeTranslationStore, 'existing' | 'save'>,
    private readonly logger: Logger,
    /** 目标没带正文时（collectReadmeTargets 收集的），处理到所在的那一片再读出来 */
    private readonly load?: (targets: ReadmeTarget[]) => Promise<void>,
    /** 记录内容上多次失败的片段；之后的运行跳过它们，等 retryFailed 时再补 */
    private readonly failures?: Pick<TranslationFailures, 'lookup' | 'record'>,
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
      fallback: 0,
      deferred: 0,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      seconds: 0,
    }
    // 分片处理：一次只把一片 README 切段、翻译、拼装，处理完释放（2026-10 导入 SKILL.md 后共 12 万篇，一次性处理会内存溢出）。
    // 目标已按星数从高到低排好，热门的先完成；相同段落跨片也只翻一次（译文都在翻译记忆库里）
    const size = options.sliceSize ?? 2_000
    for (let i = 0; i < pending.length && !options.signal?.aborted; i += size) {
      const slice = pending.slice(i, i + size)
      if (this.load) await this.load(slice.filter((t) => t.readme === undefined))
      // 正文读不到的（README 已被删除）跳过
      const loaded = slice.filter((t): t is LoadedTarget => t.readme !== undefined)
      await this.runSlice(loaded, options, stats, version, `${i / size + 1}/${Math.ceil(pending.length / size)}`)
      // 处理完释放正文：内存里同时只有一片
      if (this.load) for (const t of slice) t.readme = undefined
      // 整体进度（按篇）：后台的任务进度条用它，片内批次的 progress 只是这一片的
      this.logger.info({ stepProgress: `${Math.min(i + size, pending.length)}/${pending.length}`, assembled: stats.assembled }, 'README 翻译进度')
    }
    stats.seconds = Math.round((Date.now() - started) / 1000)
    return stats
  }

  /** 处理一片 README：切段 → 找出要翻译的片段 → 翻译 → 拼装整篇保存 */
  private async runSlice(pending: LoadedTarget[], options: ReadmeOptions, stats: ReadmeStats, version: number, label: string): Promise<void> {
    const prepared = pending.map((target) => ({ target, ...prepareReadmeChunks(target.readme, options.maxChunkChars) }))
    const isPremium = (t: ReadmeTarget) => !!this.routing.premium && (t.stars ?? 0) >= this.routing.premiumMinStars

    // 找出需要翻译的片段：按 内容指纹 × 语言 去重
    const work = new Map<string, ChunkWork>()
    // 之前内容上多次失败过的片段：放到整个任务最后（retryFailed）再补，免得每次运行都在开头反复重试
    const deferred = new Set<string>()
    for (const locale of options.locales) {
      const hashes = prepared.flatMap((p) => p.chunks.filter((c) => c.prose).map((c) => c.hash))
      const known = await this.memory.lookupDetailed(hashes, locale)
      const failed = this.failures && !options.retryFailed ? await this.failures.lookup(hashes, locale) : new Set<string>()
      for (const p of prepared) {
        for (const chunk of p.chunks) {
          // 已经是目标语言的片段（例如本来就是中文写的 README）直接沿用原文
          if (!chunk.prose || textLocale(chunk.text) === locale) continue
          const prev = known.get(chunk.hash)
          const redo = !prev || (prev.origin !== 'manual' && (options.force || (options.stale && prev.promptVersion < version)))
          if (!redo) continue
          const key = `${chunk.hash}:${locale}`
          if (!prev && failed.has(chunk.hash)) {
            deferred.add(key)
            continue
          }
          work.set(key, { hash: chunk.hash, text: chunk.text, locale, premium: (work.get(key)?.premium ?? false) || isPremium(p.target) })
        }
      }
    }

    stats.chunks += prepared.reduce((n, p) => n + p.chunks.length, 0)
    stats.work += work.size
    stats.deferred += deferred.size
    const items = [...work.values()]
    const groups: [ReadmeTranslator, ChunkWork[]][] = [
      [this.routing.standard, items.filter((w) => !w.premium || !this.routing.premium)],
      ...(this.routing.premium ? [[this.routing.premium, items.filter((w) => w.premium)] as [ReadmeTranslator, ChunkWork[]]] : []),
    ]
    this.logger.info({ slice: label, targets: pending.length, chunks: stats.chunks, work: items.length, deferred: deferred.size, groups: groups.map(([t, list]) => `${t.model}: ${list.length}`) }, '开始翻译 README')

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
        fail: async (w, reason) => {
          await this.failures?.record(w.hash, w.locale, reason, (usedBy.get(`${w.hash}:${w.locale}`) ?? translator).model)
        },
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

  /** 按 热门档 → 普通档 → 后备模型 的顺序翻译：被限流的模型暂停一段时间，期间直接用下一个；最后一个模型的错误照常抛出 */
  private async translateWithFallback(translator: ReadmeTranslator, w: ChunkWork, stats: ReadmeStats, signal?: AbortSignal) {
    const { standard, fallback } = this.routing
    const chain = [translator, ...(translator !== standard ? [standard] : []), ...(fallback ? [fallback] : [])]
    for (const [i, t] of chain.entries()) {
      const next = chain[i + 1]
      const pause = this.paused.get(t)
      if (next && pause && Date.now() < pause.until) continue
      try {
        const result = await t.translate(w.text, w.locale, signal)
        // 暂停到期后的请求成功了：已恢复，下次被限流重新从最短暂停算（暂停前发出、暂停中才返回的请求不算）
        if (pause && Date.now() >= pause.until) this.paused.delete(t)
        if (t !== translator) stats.fallback++
        return { ...result, used: t }
      } catch (error) {
        if (!next || !isRateLimited(error)) throw error
        // 并发的请求会同时被拒，只在开始暂停时记一次
        const current = this.paused.get(t)
        if (!current || Date.now() >= current.until) {
          const ms = current ? Math.min(current.ms * 2, PAUSE_MAX_MS) : PAUSE_MIN_MS
          this.paused.set(t, { until: Date.now() + ms, ms })
          this.logger.warn({ model: t.model, next: next.model, minutes: ms / 60_000 }, '模型被限流，暂停期间改用下一个模型')
        }
      }
    }
    throw new Error('没有可用的翻译模型')
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
