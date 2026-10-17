import { createReadStream, existsSync } from 'node:fs'
import { appendFile, mkdir, statfs, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import pLimit from 'p-limit'
import type { Logger } from '../core/logger.ts'
import type { ProbeTarget } from './local-targets.ts'
import type { DockerSandbox } from './sandbox.ts'
import type { LocalProbeResult, LocalProbeStatus } from './tools-store.ts'

/** 逐行读 JSONL（结果文件可能有几百 MB，不整篇读进内存） */
export async function* readJsonl<T>(file: string): AsyncGenerator<T> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as T
}

export async function writeJsonl(file: string, items: unknown[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, items.map((i) => JSON.stringify(i) + '\n').join(''))
}

/** 剩余空间低于这个值时暂停领新任务：几个带 torch 的 Python 环境同时在装就是几十 GB */
const MIN_FREE_BYTES = 15 * 1024 ** 3

export async function waitForDisk(path: string, logger: Logger, signal?: AbortSignal): Promise<void> {
  let warned = false
  for (;;) {
    const { bavail, bsize } = await statfs(path)
    if (bavail * bsize >= MIN_FREE_BYTES || signal?.aborted) return
    if (!warned) logger.warn({ freeGB: +((bavail * bsize) / 1024 ** 3).toFixed(1) }, '磁盘剩余空间不足，等进行中的实测释放空间')
    warned = true
    await sleep(15_000)
  }
}

export interface LocalProbeOptions {
  concurrency: number
  /** 检查剩余空间的路径（Docker 数据所在的盘），默认 / */
  diskPath?: string
  limit?: number
  signal?: AbortSignal
}

/**
 * 按目标文件逐个实测，结果一行一个追加到输出文件；输出文件里已有的包跳过，中断后重跑接着测。
 */
export async function runLocalProbes(sandbox: DockerSandbox, input: string, output: string, logger: Logger, options: LocalProbeOptions) {
  const done = new Set<string>()
  if (existsSync(output)) for await (const r of readJsonl<LocalProbeResult>(output)) done.add(r.key)
  else await mkdir(dirname(output), { recursive: true })
  const targets: ProbeTarget[] = []
  for await (const t of readJsonl<ProbeTarget>(input)) targets.push(t)
  const todo = targets.filter((t) => !done.has(t.key)).slice(0, options.limit)
  logger.info({ targets: targets.length, done: done.size, todo: todo.length, concurrency: options.concurrency }, '开始实测')

  const stats: Record<LocalProbeStatus, number> = { ok: 0, install_failed: 0, no_bin: 0, start_failed: 0, timeout: 0, protocol: 0 }
  const started = Date.now()
  let finished = 0
  const limit = pLimit(options.concurrency)
  await Promise.all(
    todo.map((target) =>
      limit(async () => {
        if (options.signal?.aborted) return
        await waitForDisk(options.diskPath ?? '/', logger, options.signal)
        if (options.signal?.aborted) return
        const result = await sandbox.probe(target)
        await appendFile(output, JSON.stringify(result) + '\n')
        stats[result.status]++
        finished++
        logger.debug({ key: target.key, status: result.status, tools: result.tools?.length, error: result.error }, '实测')
        if (finished % 20 === 0 || finished === todo.length) {
          const perHour = Math.round((finished / (Date.now() - started)) * 3_600_000)
          logger.info({ progress: `${finished}/${todo.length}`, perHour, ...stats }, '实测进度')
        }
      }),
    ),
  )
  return { ...stats, total: finished, minutes: Math.round((Date.now() - started) / 60_000) }
}
