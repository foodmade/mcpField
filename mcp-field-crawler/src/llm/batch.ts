import pLimit from 'p-limit'
import type { Logger } from '../core/logger.ts'
import { NoToolOutputError, TruncatedOutputError, type LlmUsage } from './claude.ts'

/** 校验问题：hard = 结果不可用，需要重做；否则保存但标记为待抽查 */
export interface Problem {
  code: string
  hard: boolean
  locale?: string
  detail?: string
}

/**
 * 一类批量大模型任务（翻译、生成介绍……）需要提供的几个步骤。
 * 分批、并发、截断后拆批、校验失败重试、统计这些通用流程由 runBatches 负责（模板方法）。
 */
export interface BatchJob<I, R> {
  key(item: I): string
  /** 用于按字符数切分批次 */
  size(item: I): number
  call(batch: I[], signal?: AbortSignal): Promise<{ results: Map<string, R>; usage: LlmUsage }>
  validate(item: I, result: R): Problem[]
  save(item: I, result: R, problems: Problem[]): Promise<void>
  describe(item: I): string
}

export interface BatchOptions {
  batchSize: number
  maxBatchChars: number
  concurrency: number
  /** 重试时的批次大小 */
  retryBatchSize?: number
  maxAttempts?: number
  signal?: AbortSignal
}

export interface BatchStats {
  total: number
  ok: number
  review: number
  failed: number
  requests: number
  inputTokens: number
  outputTokens: number
  seconds: number
}

export function toBatches<I>(items: I[], size: number, maxChars: number, sizeOf: (item: I) => number): I[][] {
  const batches: I[][] = []
  let current: I[] = []
  let chars = 0
  for (const item of items) {
    const n = sizeOf(item)
    if (current.length > 0 && (current.length >= size || chars + n > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(item)
    chars += n
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export const isHard = (problems: Problem[]) => problems.some((p) => p.hard)

/** 分批并发执行；硬性问题按小批次重做，最多 maxAttempts 次；软性问题保存为待抽查 */
export async function runBatches<I, R>(items: I[], job: BatchJob<I, R>, options: BatchOptions, logger: Logger): Promise<BatchStats> {
  const started = Date.now()
  const stats: BatchStats = { total: items.length, ok: 0, review: 0, failed: 0, requests: 0, inputTokens: 0, outputTokens: 0, seconds: 0 }
  const maxAttempts = options.maxAttempts ?? 3
  const retrySize = options.retryBatchSize ?? 5

  const process = async (batch: I[], attempt: number): Promise<void> => {
    if (options.signal?.aborted) return
    let response
    try {
      response = await job.call(batch, options.signal)
    } catch (error) {
      // 输出被截断、没有结构化结果或结构不对：拆成两半各自重试
      const splittable = error instanceof TruncatedOutputError || error instanceof NoToolOutputError || (error as Error).name === 'ZodError'
      if (batch.length > 1 && splittable) {
        const mid = Math.ceil(batch.length / 2)
        await process(batch.slice(0, mid), attempt)
        await process(batch.slice(mid), attempt)
        return
      }
      // 单条也没拿到合格的输出：再试几次
      if (splittable && attempt < maxAttempts) {
        await process(batch, attempt + 1)
        return
      }
      stats.failed += batch.length
      logger.error({ size: batch.length, err: (error as Error).message.slice(0, 300) }, '请求失败')
      return
    }

    stats.requests += response.usage.requests
    stats.inputTokens += response.usage.inputTokens
    stats.outputTokens += response.usage.outputTokens

    const retry: I[] = []
    for (const item of batch) {
      const result = response.results.get(job.key(item))
      if (!result) {
        retry.push(item)
        continue
      }
      const problems = job.validate(item, result)
      if (isHard(problems)) {
        if (attempt < maxAttempts) retry.push(item)
        else {
          stats.failed++
          logger.warn({ item: job.describe(item), problems }, '多次重做仍不合格，已跳过')
        }
        continue
      }
      try {
        await job.save(item, result, problems)
      } catch (error) {
        // 单条写库失败只记一条失败，不中断整个任务；下次运行会重新处理
        stats.failed++
        logger.error({ item: job.describe(item), err: (error as Error).message.slice(0, 300) }, '保存失败')
        continue
      }
      if (problems.length > 0) stats.review++
      else stats.ok++
    }

    logger.info({ progress: `${stats.ok + stats.review}/${stats.total}`, batch: batch.length, retry: retry.length, attempt }, '批次完成')
    for (const small of toBatches(retry, retrySize, options.maxBatchChars, job.size)) await process(small, attempt + 1)
  }

  const limit = pLimit(options.concurrency)
  await Promise.all(toBatches(items, options.batchSize, options.maxBatchChars, job.size).map((batch) => limit(() => process(batch, 1))))
  stats.seconds = Math.round((Date.now() - started) / 1000)
  return stats
}
