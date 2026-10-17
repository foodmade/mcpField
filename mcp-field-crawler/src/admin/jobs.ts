import { eq, sql } from 'drizzle-orm'
import { hostname } from 'node:os'
import type { Db } from '../db/client.ts'
import { adminJobBatches, adminJobRuns } from '../db/schema/index.ts'

/*
 * 任务运行埋点：CLI 每跑一个命令，在 admin_job_runs 里记一行（开始、心跳、进度、最后几条警告错误、结束时的统计）。
 * 每日任务（daily.sh）先用 job-batch start 建一个批次，把批次号放进环境变量 MCPFIELD_BATCH_ID，各步骤的运行挂到这个批次下。
 * 埋点只写库、不抛错：数据库写失败只打一条警告，不能影响任务本身。
 */

export type JobStatus = 'running' | 'succeeded' | 'warning' | 'failed' | 'interrupted'

export interface LogEntry {
  at: string
  level: 'warn' | 'error'
  msg: string
  detail?: string
}

const TAIL_SIZE = 30
const HEARTBEAT_MS = 15_000
const DETAIL_KEYS = ['err', 'cause', 'item', 'problems', 'status', 'url', 'key', 'reason'] as const

/** 北京时间的日期（YYYY-MM-DD）：每日任务 03:30 北京时间开始，按北京时间归日 */
export function beijingDate(at: Date): string {
  return new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}

/** 日志里的 progress: "12/340" */
export function parseProgress(value: unknown): { done: number; total: number } | null {
  if (typeof value !== 'string') return null
  const m = /^(\d+)\/(\d+)$/.exec(value.trim())
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null
}

/**
 * 从命令返回的统计里汇总成功 / 待抽查 / 失败条数：各任务的统计结构不同，但都用 ok / review / failed 命名，
 * 嵌套一层的（github 返回 { repos, readme }）一起加；没有 ok 的（crawl、publish）用 records / published 代替
 */
export function summarizeStats(stats: unknown): { ok: number | null; review: number | null; failed: number | null } {
  const sum = { ok: null as number | null, review: null as number | null, failed: null as number | null }
  const add = (key: 'ok' | 'review' | 'failed', value: unknown) => {
    if (typeof value === 'number') sum[key] = (sum[key] ?? 0) + value
  }
  const visit = (obj: Record<string, unknown>, depth: number) => {
    add('ok', obj.ok ?? obj.records ?? obj.published ?? obj.applied)
    add('review', obj.review)
    add('failed', obj.failed)
    if (depth > 0) for (const v of Object.values(obj)) if (v && typeof v === 'object' && !Array.isArray(v)) visit(v as Record<string, unknown>, depth - 1)
  }
  if (stats && typeof stats === 'object') visit(stats as Record<string, unknown>, 1)
  return sum
}

/** 结束状态：抛错为失败，被停止为中断，跑完但有条目失败为警告 */
export function finalStatus(outcome: { error?: unknown; interrupted?: boolean; failed?: number | null }): JobStatus {
  if (outcome.interrupted) return 'interrupted'
  if (outcome.error !== undefined) return 'failed'
  return (outcome.failed ?? 0) > 0 ? 'warning' : 'succeeded'
}

function detailOf(obj: Record<string, unknown>): string | undefined {
  const parts = DETAIL_KEYS.flatMap((k) => (obj[k] === undefined ? [] : [`${k}=${typeof obj[k] === 'string' ? obj[k] : JSON.stringify(obj[k])}`]))
  return parts.length ? parts.join(' ').slice(0, 500) : undefined
}

export interface Warn {
  (obj: object, msg: string): void
}

/** 一个命令的一次运行 */
export class JobTracker {
  private progress: { done: number; total: number } | null = null
  /** README 翻译按片报告整体进度（stepProgress），收到后不再用批次级的 progress */
  private stepProgressSeen = false
  private tail: LogEntry[] = []
  private dirty = false
  private timer?: NodeJS.Timeout
  private finished = false
  interrupted = false

  private constructor(
    private readonly db: Db,
    readonly id: number,
    private readonly warn: Warn,
  ) {}

  static async start(db: Db, input: { step: string; args: string; batchId?: number }, warn: Warn): Promise<JobTracker | undefined> {
    try {
      const now = new Date()
      const [result] = await db.insert(adminJobRuns).values({
        batchId: input.batchId ?? null,
        step: input.step,
        args: input.args.slice(0, 255),
        status: 'running',
        host: hostname().slice(0, 128),
        pid: process.pid,
        startedAt: now,
        heartbeatAt: now,
      })
      const tracker = new JobTracker(db, Number(result.insertId), warn)
      tracker.timer = setInterval(() => void tracker.flush(), HEARTBEAT_MS)
      tracker.timer.unref()
      return tracker
    } catch (error) {
      warn({ err: (error as Error).message }, '任务埋点：记录开始失败，本次运行不记录')
      return undefined
    }
  }

  /** 日志钩子：取进度，留下警告和错误 */
  observe(level: number, obj: Record<string, unknown> | undefined, msg: string | undefined): void {
    if (obj) {
      const step = parseProgress(obj.stepProgress)
      if (step) {
        this.stepProgressSeen = true
        this.progress = step
        this.dirty = true
      } else if (!this.stepProgressSeen) {
        const p = parseProgress(obj.progress)
        if (p) {
          this.progress = p
          this.dirty = true
        }
      }
    }
    if (level >= 40) {
      this.tail.push({ at: new Date().toISOString(), level: level >= 50 ? 'error' : 'warn', msg: (msg ?? '').slice(0, 300), detail: obj ? detailOf(obj) : undefined })
      if (this.tail.length > TAIL_SIZE) this.tail.shift()
      this.dirty = true
    }
  }

  private async flush(): Promise<void> {
    if (this.finished) return
    const dirty = this.dirty
    this.dirty = false
    try {
      await this.db
        .update(adminJobRuns)
        .set({
          heartbeatAt: new Date(),
          ...(dirty ? { progressDone: this.progress?.done ?? null, progressTotal: this.progress?.total ?? null, logTail: this.tail } : {}),
        })
        .where(eq(adminJobRuns.id, this.id))
    } catch (error) {
      this.warn({ err: (error as Error).message }, '任务埋点：心跳写入失败')
    }
  }

  async finish(outcome: { stats?: unknown; error?: unknown }): Promise<void> {
    if (this.finished) return
    this.finished = true
    clearInterval(this.timer)
    const counts = summarizeStats(outcome.stats)
    const status = finalStatus({ error: outcome.error, interrupted: this.interrupted, failed: counts.failed })
    try {
      await this.db
        .update(adminJobRuns)
        .set({
          status,
          okCount: counts.ok,
          reviewCount: counts.review,
          failedCount: counts.failed,
          summary: outcome.stats ?? null,
          error: outcome.error === undefined ? null : outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
          progressDone: this.progress?.done ?? null,
          progressTotal: this.progress?.total ?? null,
          logTail: this.tail,
          heartbeatAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(adminJobRuns.id, this.id))
    } catch (error) {
      this.warn({ err: (error as Error).message }, '任务埋点：记录结束失败')
    }
  }
}

/** 每日任务的批次：daily.sh 开始时建、结束时收尾 */
export async function startBatch(db: Db, input: { trigger: string; steps: string[] }): Promise<number> {
  const now = new Date()
  const [result] = await db.insert(adminJobBatches).values({
    trigger: input.trigger.slice(0, 16),
    runDate: beijingDate(now),
    steps: input.steps,
    status: 'running',
    host: hostname().slice(0, 128),
    pid: process.ppid,
    startedAt: now,
  })
  return Number(result.insertId)
}

export async function finishBatch(db: Db, id: number, status: 'succeeded' | 'failed' | 'interrupted'): Promise<void> {
  await db.update(adminJobBatches).set({ status, finishedAt: new Date() }).where(eq(adminJobBatches.id, id))
}

/** 批次下还在 running 但进程已经不在的运行（被 kill -9、机器重启）：心跳超过 5 分钟没更新的记为中断 */
export async function markStaleRuns(db: Db): Promise<void> {
  await db.execute(sql`UPDATE admin_job_runs SET status = 'interrupted', finished_at = heartbeat_at
    WHERE status = 'running' AND heartbeat_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE`)
  await db.execute(sql`UPDATE admin_job_batches b SET status = 'interrupted', finished_at = UTC_TIMESTAMP(3)
    WHERE status = 'running' AND started_at < UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE
      AND NOT EXISTS (SELECT 1 FROM admin_job_runs r WHERE r.batch_id = b.id AND r.status = 'running')
      AND NOT EXISTS (SELECT 1 FROM admin_job_runs r WHERE r.batch_id = b.id AND COALESCE(r.finished_at, r.heartbeat_at) > UTC_TIMESTAMP(3) - INTERVAL 10 MINUTE)`)
}
