import { sql, type SQL } from 'drizzle-orm'
import { beijingDate } from '../admin/jobs.ts'
import { dbTime } from '../admin/time.ts'
import { STAGE_COLUMN, STAGES, type Stage } from '../admin/sync.ts'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import { ENTITY_KINDS, type EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { adminItemStatus } from '../db/schema/index.ts'

/*
 * 后台的读接口：只读 admin_* 表（条目状态宽表、覆盖率、运行记录），不碰发布层，数据量再大也是走索引的小查询。
 */

export type StageState = 'na' | 'pending' | 'running' | 'ok' | 'warn' | 'failed'
export type RunState = 'running' | 'succeeded' | 'warning' | 'failed' | 'interrupted'
export type StepState = RunState | 'queued' | 'skipped'

const CODE_STATE: StageState[] = ['na', 'pending', 'ok', 'warn', 'failed']
const STATE_CODE: Record<Exclude<StageState, 'running'>, number> = { na: 0, pending: 1, ok: 2, warn: 3, failed: 4 }

/** 正在运行的命令会处理哪些步骤：这些步骤里“待处理”的条目显示为“进行中” */
export const RUNNING_STAGES: Record<string, Stage[]> = {
  classify: ['classify'],
  probe: ['tools'],
  assets: ['icon'],
  'owner-icons': ['icon'],
  github: ['github', 'readme'],
  translate: ['translate'],
  'translate-tools': ['tools_translate'],
  describe: ['intro'],
  overview: ['intro'],
  readme: ['readme_translate'],
}

/** 运行中但心跳超过这么久没更新：进程已经不在了 */
const STALE_MS = 5 * 60_000

async function query<T>(db: Db, statement: SQL): Promise<T[]> {
  const [rows] = (await db.execute(statement)) as unknown as [T[]]
  return rows
}

const iso = (d: Date | string | null) => (d === null ? null : dbTime(d).toISOString())
const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

/* ========== 运行记录 ========== */

interface RunRow {
  id: number
  batchId: number | null
  step: string
  args: string
  status: string
  progressDone: number | null
  progressTotal: number | null
  okCount: number | null
  reviewCount: number | null
  failedCount: number | null
  summary: unknown
  error: string | null
  logTail: unknown
  startedAt: Date
  heartbeatAt: Date
  finishedAt: Date | null
}

export interface RunView {
  id: number
  batchId: number | null
  step: string
  args: string
  status: RunState
  progress: { done: number; total: number } | null
  counts: { ok: number | null; review: number | null; failed: number | null }
  error: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number
  logTail: { at: string; level: string; msg: string; detail?: string }[]
  summary?: unknown
}

const RUN_COLUMNS = sql`id, batch_id AS batchId, step, args, status, progress_done AS progressDone, progress_total AS progressTotal,
  ok_count AS okCount, review_count AS reviewCount, failed_count AS failedCount, summary, error, log_tail AS logTail,
  started_at AS startedAt, heartbeat_at AS heartbeatAt, finished_at AS finishedAt`

function runView(r: RunRow, now: Date, withSummary = false): RunView {
  const stale = r.status === 'running' && now.getTime() - dbTime(r.heartbeatAt).getTime() > STALE_MS
  const end = r.finishedAt ? dbTime(r.finishedAt) : stale ? dbTime(r.heartbeatAt) : now
  return {
    id: r.id,
    batchId: r.batchId,
    step: r.step,
    args: r.args,
    status: (stale ? 'interrupted' : r.status) as RunState,
    progress: r.progressTotal ? { done: r.progressDone ?? 0, total: r.progressTotal } : null,
    counts: { ok: r.okCount, review: r.reviewCount, failed: r.failedCount },
    error: r.error,
    startedAt: iso(r.startedAt)!,
    finishedAt: iso(r.finishedAt),
    durationMs: end.getTime() - dbTime(r.startedAt).getTime(),
    logTail: json<RunView['logTail'] | null>(r.logTail) ?? [],
    ...(withSummary ? { summary: json(r.summary) } : {}),
  }
}

const SEVERITY: Record<string, number> = { failed: 5, interrupted: 4, running: 3, warning: 2, succeeded: 1 }
const worst = (states: RunState[]) => states.reduce((a, b) => (SEVERITY[b]! > SEVERITY[a]! ? b : a), 'succeeded' as RunState)

export interface StepView {
  step: string
  status: StepState
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  progress: { done: number; total: number } | null
  counts: { ok: number; review: number; failed: number }
  error: string | null
  runs: RunView[]
}

/** 批次里的一步：crawl 每个来源各跑一次，合在一起看 */
function stepView(step: string, runs: RunView[], batchRunning: boolean): StepView {
  const sum = (k: 'ok' | 'review' | 'failed') => runs.reduce((n, r) => n + (r.counts[k] ?? 0), 0)
  const running = runs.find((r) => r.status === 'running')
  return {
    step,
    status: runs.length ? worst(runs.map((r) => r.status)) : batchRunning ? 'queued' : 'skipped',
    startedAt: runs[0]?.startedAt ?? null,
    finishedAt: runs.length && runs.every((r) => r.finishedAt) ? runs.at(-1)!.finishedAt : null,
    durationMs: runs.reduce((n, r) => n + r.durationMs, 0),
    progress: running?.progress ?? null,
    counts: { ok: sum('ok'), review: sum('review'), failed: sum('failed') },
    error: runs.find((r) => r.error)?.error ?? null,
    runs,
  }
}

interface BatchRow {
  id: number
  trigger: string
  runDate: string
  steps: unknown
  status: string
  startedAt: Date
  finishedAt: Date | null
}

export interface BatchView {
  id: number
  trigger: string
  date: string
  status: RunState
  startedAt: string
  finishedAt: string | null
  durationMs: number
  steps: StepView[]
  /** 计划步骤以外的运行（例如 admin-sync） */
  extra: RunView[]
}

const BATCH_COLUMNS = sql`id, \`trigger\`, DATE_FORMAT(run_date, '%Y-%m-%d') AS runDate, steps, status, started_at AS startedAt, finished_at AS finishedAt`

async function batchView(db: Db, b: BatchRow, now: Date): Promise<BatchView> {
  const runs = (await query<RunRow>(db, sql`SELECT ${RUN_COLUMNS} FROM admin_job_runs WHERE batch_id = ${b.id} ORDER BY id`)).map((r) => runView(r, now))
  const planned = json<string[]>(b.steps)
  // 批次还标着 running：有步骤在跑，或上一步刚结束（下一步正在启动），才算真的在跑；否则是 daily.sh 被杀了
  const recent = (at: string | Date) => now.getTime() - dbTime(at).getTime() < STALE_MS * 2
  const running = b.status === 'running' && (runs.length ? runs.some((r) => r.status === 'running' || recent(r.finishedAt ?? r.startedAt)) : recent(b.startedAt))
  const steps = planned.map((s) => stepView(s, runs.filter((r) => r.step === s), running))
  const states = steps.flatMap((s) => (s.status === 'queued' || s.status === 'skipped' ? [] : [s.status]))
  const status: RunState = running ? 'running' : b.status === 'running' ? 'interrupted' : states.length ? worst(states) : (b.status as RunState)
  const end = b.finishedAt ? dbTime(b.finishedAt) : now
  return {
    id: b.id,
    trigger: b.trigger,
    date: b.runDate,
    status,
    startedAt: iso(b.startedAt)!,
    finishedAt: iso(b.finishedAt),
    durationMs: end.getTime() - dbTime(b.startedAt).getTime(),
    steps,
    extra: runs.filter((r) => !planned.includes(r.step)),
  }
}

/** 某天（北京时间）的批次：优先定时任务的，没有时取手动的；同一天多次取最新 */
async function batchOn(db: Db, date: string, now: Date): Promise<BatchView | null> {
  const [b] = await query<BatchRow>(db, sql`SELECT ${BATCH_COLUMNS} FROM admin_job_batches WHERE run_date = ${date} ORDER BY \`trigger\` = 'cron' DESC, id DESC LIMIT 1`)
  return b ? batchView(db, b, now) : null
}

/** 最近几天每天的任务结果（日历格子、柱状图下的圆点） */
async function batchHistory(db: Db, from: string): Promise<Map<string, RunState>> {
  const rows = await query<{ runDate: string; status: string; failed: number; warned: number; running: number }>(
    db,
    sql`SELECT DATE_FORMAT(b.run_date, '%Y-%m-%d') AS runDate, b.status,
          SUM(r.status = 'failed') AS failed, SUM(r.status IN ('warning', 'interrupted')) AS warned,
          SUM(r.status = 'running' AND r.heartbeat_at > UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE) AS running
        FROM admin_job_batches b LEFT JOIN admin_job_runs r ON r.batch_id = b.id
        WHERE b.run_date >= ${from}
        GROUP BY b.id ORDER BY b.\`trigger\` = 'cron', b.id`,
  )
  const out = new Map<string, RunState>()
  for (const r of rows) {
    const state: RunState = Number(r.running) ? 'running' : Number(r.failed) ? 'failed' : r.status === 'interrupted' ? 'interrupted' : Number(r.warned) ? 'warning' : r.status === 'running' ? 'interrupted' : 'succeeded'
    out.set(r.runDate, state)
  }
  return out
}

function lastDays(today: string, n: number): string[] {
  const base = new Date(`${today}T00:00:00Z`).getTime()
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86400_000).toISOString().slice(0, 10))
}

/* ========== 仪表盘 ========== */

export interface CoverageRow {
  kind: EntityKind
  stage: Stage
  na: number
  pending: number
  ok: number
  warn: number
  failed: number
}

export async function dashboard(db: Db, now = new Date()) {
  const today = beijingDate(now)
  const days = lastDays(today, 14)
  const [batch, history, newRows, coverage, failing, recent] = await Promise.all([
    batchOn(db, today, now),
    batchHistory(db, days[0]!),
    query<{ date: string; kind: EntityKind; n: number }>(
      db,
      sql`SELECT DATE_FORMAT(first_seen_date, '%Y-%m-%d') AS date, kind, COUNT(*) AS n FROM admin_item_status
          WHERE first_seen_date >= ${days[0]} GROUP BY first_seen_date, kind`,
    ),
    query<CoverageRow>(db, sql`SELECT kind, stage, na, pending, ok, warn, failed FROM admin_coverage`),
    query<{ kind: EntityKind; n: number }>(db, sql`SELECT kind, COUNT(*) AS n FROM admin_item_status WHERE active = 1 AND has_fail = 1 GROUP BY kind`),
    query<RunRow>(db, sql`SELECT ${RUN_COLUMNS} FROM admin_job_runs WHERE started_at > UTC_TIMESTAMP(3) - INTERVAL 7 DAY ORDER BY id DESC LIMIT 300`),
  ])

  const daily = days.map((date) => {
    const byKind = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>
    for (const r of newRows) if (r.date === date) byKind[r.kind] = Number(r.n)
    return { date, byKind, total: Object.values(byKind).reduce((a, b) => a + b, 0), status: history.get(date) ?? null }
  })
  const totals = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>
  for (const c of coverage) if (c.stage === 'classify') totals[c.kind] = Number(c.na) + Number(c.pending) + Number(c.ok) + Number(c.warn) + Number(c.failed)

  // 最近 7 天的异常：失败、有警告、被中断的运行；之后同一步骤又成功跑过的算已恢复
  const runs = recent.map((r) => runView(r, now))
  const issues = runs
    .filter((r) => r.status === 'failed' || r.status === 'warning' || r.status === 'interrupted')
    .slice(0, 12)
    .map((r) => ({
      ...r,
      resolved: runs.some((later) => later.step === r.step && later.id > r.id && later.status === 'succeeded'),
      message: r.error ?? r.logTail.filter((l) => l.level === 'error').at(-1)?.msg ?? r.logTail.at(-1)?.msg ?? null,
    }))

  return {
    today,
    batch,
    daily,
    totals,
    failingItems: Object.fromEntries(failing.map((f) => [f.kind, Number(f.n)])),
    coverage: coverage.map((c) => ({ ...c, na: Number(c.na), pending: Number(c.pending), ok: Number(c.ok), warn: Number(c.warn), failed: Number(c.failed) })),
    issues,
  }
}

/* ========== 每日采集 ========== */

export async function dailyRun(db: Db, date: string, now = new Date()) {
  const days = lastDays(beijingDate(now), 14)
  const start = new Date(`${date}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 86400_000)
  const [batch, history, manual, newCounts] = await Promise.all([
    batchOn(db, date, now),
    batchHistory(db, days[0]!),
    query<RunRow>(db, sql`SELECT ${RUN_COLUMNS} FROM admin_job_runs WHERE batch_id IS NULL AND started_at >= ${start} AND started_at < ${end} ORDER BY id`),
    query<{ kind: EntityKind; n: number }>(db, sql`SELECT kind, COUNT(*) AS n FROM admin_item_status WHERE first_seen_date = ${date} GROUP BY kind`),
  ])
  const byKind = Object.fromEntries(ENTITY_KINDS.map((k) => [k, 0])) as Record<EntityKind, number>
  for (const r of newCounts) byKind[r.kind] = Number(r.n)
  return {
    date,
    batch,
    history: days.map((d) => ({ date: d, status: history.get(d) ?? null })),
    manual: manual.map((r) => runView(r, now)),
    newByKind: byKind,
  }
}

export async function runDetail(db: Db, id: number, now = new Date()): Promise<RunView | null> {
  const [r] = await query<RunRow>(db, sql`SELECT ${RUN_COLUMNS} FROM admin_job_runs WHERE id = ${id}`)
  return r ? runView(r, now, true) : null
}

/** 正在运行的步骤（心跳新鲜的） */
export async function runningSteps(db: Db): Promise<string[]> {
  const rows = await query<{ step: string }>(db, sql`SELECT DISTINCT step FROM admin_job_runs WHERE status = 'running' AND heartbeat_at > UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE`)
  return rows.map((r) => r.step)
}

/* ========== 条目列表 ========== */

export interface ItemQuery {
  kind?: EntityKind
  date?: string
  q?: string
  category?: string
  source?: string
  /** fail：有失败的步骤 / warn：有警告 / pending：有待处理 */
  issue?: 'fail' | 'warn' | 'pending'
  stage?: Stage
  stageState?: Exclude<StageState, 'running'>
  sort: 'new' | 'popular' | 'name'
  page: number
  pageSize: number
}

interface ItemRow {
  id: number
  kind: EntityKind
  slug: string
  name: string
  iconUrl: string | null
  category: string | null
  sources: string
  popularity: number | null
  firstSeenAt: Date
  publishedAt: Date
  active: number
  notes: unknown
  failCount: number
  [column: string]: unknown
}

const STAGE_SELECT = sql.raw(STAGES.map((s) => `\`${adminItemStatus[STAGE_COLUMN[s]].name}\` AS \`${s}\``).join(', '))
const stageColumn = (s: Stage) => sql.raw(`\`${adminItemStatus[STAGE_COLUMN[s]].name}\``)
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function listItems(db: Db, q: ItemQuery, siteUrl: string) {
  const where: SQL[] = []
  // 按某天看时连已下架的也列出来（当天收录过）；其余只看在架的
  if (q.date) where.push(sql`first_seen_date = ${q.date}`)
  else where.push(sql`active = 1`)
  if (q.kind) where.push(sql`kind = ${q.kind}`)
  if (q.category) where.push(q.category === 'none' ? sql`category IS NULL` : sql`category = ${q.category}`)
  if (q.source) where.push(sql`FIND_IN_SET(${q.source}, sources) > 0`)
  if (q.issue === 'fail') where.push(sql`has_fail = 1`)
  if (q.issue === 'warn') where.push(sql`warn_count > 0`)
  if (q.issue === 'pending') where.push(sql`pending_count > 0`)
  if (q.stage && q.stageState) where.push(sql`${stageColumn(q.stage)} = ${STATE_CODE[q.stageState]}`)
  if (q.q) {
    const like = `%${escapeLike(q.q)}%`
    where.push(sql`(name LIKE ${like} OR slug LIKE ${like} OR external_id LIKE ${like})`)
  }
  const cond = sql.join(where, sql` AND `)
  const order = q.sort === 'popular' ? sql`popularity IS NULL, popularity DESC, id DESC` : q.sort === 'name' ? sql`name, id` : sql`first_seen_at DESC, id DESC`

  // 先在索引上翻到这一页的 id，再取整行（深分页时不用把前面的整行都读出来）
  const [ids, [count], running] = await Promise.all([
    query<{ id: number }>(db, sql`SELECT id FROM admin_item_status WHERE ${cond} ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
    query<{ total: number }>(db, sql`SELECT COUNT(*) AS total FROM admin_item_status WHERE ${cond}`),
    runningSteps(db),
  ])
  const rows = ids.length
    ? await query<ItemRow>(
        db,
        sql`SELECT id, kind, slug, name, icon_url AS iconUrl, category, sources, popularity, first_seen_at AS firstSeenAt, published_at AS publishedAt,
              active, notes, fail_count AS failCount, ${STAGE_SELECT}
            FROM admin_item_status WHERE id IN (${sql.join(ids.map((r) => sql`${r.id}`), sql`, `)})`,
      )
    : []
  const byId = new Map(rows.map((r) => [r.id, r]))
  const runningStages = new Set(running.flatMap((s) => RUNNING_STAGES[s] ?? []))
  const data = ids.map(({ id }) => {
    const r = byId.get(id)!
    const notes = json<Record<string, string | null> | null>(r.notes) ?? {}
    const stages = Object.fromEntries(
      STAGES.map((s) => {
        const state = CODE_STATE[Number(r[s])] ?? 'pending'
        return [s, { state: state === 'pending' && runningStages.has(s) ? 'running' : state, note: notes[s] ?? null }]
      }),
    ) as Record<Stage, { state: StageState; note: string | null }>
    return {
      kind: r.kind,
      slug: r.slug,
      name: r.name,
      iconUrl: r.iconUrl,
      category: r.category,
      sources: r.sources.split(','),
      popularity: r.popularity,
      firstSeenAt: iso(r.firstSeenAt),
      publishedAt: iso(r.publishedAt),
      active: !!Number(r.active),
      url: `${siteUrl}/${ROUTE_BY_KIND[r.kind]}/${r.slug}`,
      stages,
    }
  })
  const totalNum = Number(count?.total ?? 0)
  return { data, meta: { page: q.page, pageSize: q.pageSize, total: totalNum, totalPages: Math.max(1, Math.ceil(totalNum / q.pageSize)) } }
}

/** 筛选项：某类型的分类、来源及条目数 */
export async function itemFacets(db: Db, kind: EntityKind) {
  const [categories, sources] = await Promise.all([
    query<{ category: string | null; n: number }>(db, sql`SELECT category, COUNT(*) AS n FROM admin_item_status WHERE kind = ${kind} AND active = 1 GROUP BY category ORDER BY n DESC`),
    query<{ sources: string; n: number }>(db, sql`SELECT sources, COUNT(*) AS n FROM admin_item_status WHERE kind = ${kind} AND active = 1 GROUP BY sources`),
  ])
  const bySource = new Map<string, number>()
  for (const s of sources) for (const id of s.sources.split(',')) bySource.set(id, (bySource.get(id) ?? 0) + Number(s.n))
  return {
    categories: categories.map((c) => ({ slug: c.category ?? 'none', count: Number(c.n) })),
    sources: [...bySource].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
  }
}
