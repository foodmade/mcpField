import { setTimeout as sleep } from 'node:timers/promises'
import type { Logger } from '../core/logger.ts'
import { waitForDisk } from './local-runner.ts'
import { QUEUE, type ProbeJob, type ProbePool, type QueueClient } from './queue.ts'
import { probeRemote } from './remote.ts'
import type { DockerSandbox } from './sandbox.ts'
import type { ToolsProbeResult } from './tools-store.ts'

export interface ProbeWorkerOptions {
  /** 本地包（Docker 沙箱）和远程服务各自的并发数 */
  local: number
  remote: number
  /** 检查剩余空间的路径（Docker 数据所在的盘），默认 / */
  diskPath?: string
  signal: AbortSignal
}

/** BLPOP 的等待秒数：到点没有任务就再等一轮，顺便检查是否要退出 */
const POLL_SECONDS = 5
/** 单个任务的上限（装包 5 分钟、换参数重试几次之外再留余量）：超过就记为 timeout，免得并发位被一直占住 */
const JOB_TIMEOUT_MS = 20 * 60_000

/**
 * 实测机常驻的 worker：从线上的队列取目标，本地包在 Docker 沙箱里装上启动、远程服务直接读 tools/list，结果写回队列。
 * BLPOP 会占住连接，每个并发位各用一条连接；先取 high（当天新收录的）再取 low（积压、到期重测）。
 * 收到中断信号后不再领新任务，等进行中的实测完成再退出；被强行杀掉时丢失的任务，线上过两天会重新投递。
 */
export async function runProbeWorker(client: QueueClient, sandbox: DockerSandbox, logger: Logger, options: ProbeWorkerOptions) {
  const started = Date.now()
  const stats: Record<string, number> = {}
  let finished = 0

  const run = async (job: ProbeJob): Promise<ToolsProbeResult> => {
    const timedOut = (): ToolsProbeResult => ({ key: job.key, status: job.registryType === 'remote' ? 'network' : 'timeout', error: 'job timeout', probedAt: new Date().toISOString() })
    try {
      const probing = job.registryType === 'remote' ? probeRemote(job) : sandbox.probe(job)
      return await Promise.race([probing, sleep(JOB_TIMEOUT_MS, undefined, { ref: false }).then(timedOut)])
    } catch (error) {
      return { key: job.key, status: job.registryType === 'remote' ? 'network' : 'start_failed', error: (error as Error).message.slice(0, 500), probedAt: new Date().toISOString() }
    }
  }

  const slot = async (pool: ProbePool) => {
    const conn = client.duplicate()
    conn.on('error', (error: Error) => logger.warn({ err: error.message }, 'Redis 连接出错，自动重连'))
    await conn.connect()
    try {
      while (!options.signal.aborted) {
        if (pool === 'local') await waitForDisk(options.diskPath ?? '/', logger, options.signal)
        if (options.signal.aborted) break
        const popped = await conn.blPop([QUEUE.jobs(pool, 'high'), QUEUE.jobs(pool, 'low')], POLL_SECONDS)
        if (!popped) continue
        const job = JSON.parse(popped.element) as ProbeJob
        const result = await run(job)
        await conn.rPush(QUEUE.results, JSON.stringify(result))
        stats[result.status] = (stats[result.status] ?? 0) + 1
        finished++
        logger.debug({ key: job.key, status: result.status, tools: result.tools?.length, error: result.error }, '实测')
        if (finished % 50 === 0) {
          const perHour = Math.round((finished / (Date.now() - started)) * 3_600_000)
          logger.info({ finished, perHour, ...stats }, '实测进度')
        }
      }
    } finally {
      await conn.close()
    }
  }

  logger.info({ local: options.local, remote: options.remote }, '实测 worker 已启动，等待任务')
  await Promise.all([...Array.from({ length: options.local }, () => slot('local')), ...Array.from({ length: options.remote }, () => slot('remote'))])
  return { finished, ...stats, minutes: Math.round((Date.now() - started) / 60_000) }
}
