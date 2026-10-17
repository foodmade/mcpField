import { boolean, date, index, int, json, mysqlTable, primaryKey, smallint, text, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { at, kindCol, pk, ref, sha256, sourceIdCol, timestamps } from './columns.ts'

/*
 * 管理后台（admin_*）：只有后台接口和采集任务的埋点读写，网站不读。
 *   admin_users / admin_sessions  账号与登录会话
 *   admin_job_batches             一次每日任务（daily.sh）或一次手动运行
 *   admin_job_runs                一个命令的一次运行：状态、进度、统计、最后几条警告和错误
 *   admin_item_status             每个发布条目一行的宽表：各补全步骤的状态灯 + 列表要显示的冗余字段
 *   admin_coverage                各类型 × 各步骤的状态计数，仪表盘直接读
 * 条目状态由 admin/sync.ts 从各结果表推导后写入（每步结束时只刷新相关的列），任务本身不逐条埋点。
 */

export const adminUsers = mysqlTable('admin_users', {
  id: pk(),
  username: varchar('username', { length: 64 }).notNull().unique('uq_admin_users_username'),
  /** scrypt$N$r$p$salt$hash（见 api/admin/password.ts） */
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  /** 连续登录失败次数，成功后清零；达到上限锁定一段时间 */
  failedAttempts: smallint('failed_attempts', { unsigned: true }).notNull().default(0),
  lockedUntil: at('locked_until'),
  lastLoginAt: at('last_login_at'),
  passwordChangedAt: at('password_changed_at'),
  ...timestamps(),
})

export const adminSessions = mysqlTable(
  'admin_sessions',
  {
    id: pk(),
    /** 会话令牌的 SHA-256，令牌本身只在 cookie 里 */
    tokenHash: sha256('token_hash').notNull().unique('uq_admin_sessions_token'),
    userId: ref('user_id').notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: at('created_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [index('ix_admin_sessions_user').on(t.userId), index('ix_admin_sessions_expires').on(t.expiresAt)],
)

export const adminJobBatches = mysqlTable(
  'admin_job_batches',
  {
    id: pk(),
    /** cron：每日定时 / manual：mcpfield data 手动 */
    trigger: varchar('trigger', { length: 16 }).notNull(),
    /** 北京时间的日期，后台按它查某一天 */
    runDate: date('run_date', { mode: 'string' }).notNull(),
    /** 计划执行的步骤，按顺序 */
    steps: json('steps').$type<string[]>().notNull(),
    /** running / succeeded / failed（有步骤失败）/ interrupted */
    status: varchar('status', { length: 16 }).notNull().default('running'),
    host: varchar('host', { length: 128 }),
    pid: int('pid', { unsigned: true }),
    startedAt: at('started_at').notNull(),
    finishedAt: at('finished_at'),
  },
  (t) => [index('ix_admin_job_batches_date').on(t.runDate, t.startedAt)],
)

export const adminJobRuns = mysqlTable(
  'admin_job_runs',
  {
    id: pk(),
    /** 每日任务里的步骤属于哪个批次；mcpfield run 单独跑的为空 */
    batchId: ref('batch_id'),
    /** 步骤名（crawl / publish / readme ……），即 CLI 命令名 */
    step: varchar('step', { length: 32 }).notNull(),
    /** 命令行参数，例如 --source mcp-registry --since auto */
    args: varchar('args', { length: 255 }).notNull().default(''),
    /** running / succeeded / warning（跑完但有条目失败）/ failed / interrupted（被停止） */
    status: varchar('status', { length: 16 }).notNull().default('running'),
    progressDone: int('progress_done', { unsigned: true }),
    progressTotal: int('progress_total', { unsigned: true }),
    /** 从统计里汇总的成功 / 待抽查 / 失败条数 */
    okCount: int('ok_count', { unsigned: true }),
    reviewCount: int('review_count', { unsigned: true }),
    failedCount: int('failed_count', { unsigned: true }),
    /** 命令结束时返回的完整统计 */
    summary: json('summary'),
    error: text('error'),
    /** 最后 30 条警告和错误日志（[{ at, level, msg, ... }]） */
    logTail: json('log_tail'),
    host: varchar('host', { length: 128 }),
    pid: int('pid', { unsigned: true }),
    startedAt: at('started_at').notNull(),
    /** 运行中每 15 秒更新一次；状态还是 running 但很久没更新，说明进程被杀了 */
    heartbeatAt: at('heartbeat_at').notNull(),
    finishedAt: at('finished_at'),
  },
  (t) => [index('ix_admin_job_runs_batch').on(t.batchId), index('ix_admin_job_runs_step').on(t.step, t.startedAt), index('ix_admin_job_runs_started').on(t.startedAt)],
)

/**
 * 条目状态宽表：一行 = 一个发布条目（按主条目的 来源 + 类型 + ID 关联；发布层每次重建 id 会变，这里不用它的 id）。
 * 名称、图标、分类、星数等是从发布层冗余过来的，后台列表只查这一张表。
 * 各步骤状态：0 不适用 / 1 待处理 / 2 完成 / 3 警告（待抽查、部分完成）/ 4 失败；“进行中”由接口按正在运行的步骤推算，不存。
 */
export const adminItemStatus = mysqlTable(
  'admin_item_status',
  {
    id: pk(),
    kind: kindCol(),
    sourceId: sourceIdCol().notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 191 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    /** 转存后的图标地址，没转存时是原图地址 */
    iconUrl: varchar('icon_url', { length: 1024 }),
    /** 主分类 slug */
    category: varchar('category', { length: 64 }),
    sources: varchar('sources', { length: 255 }).notNull(),
    /** 热度：GitHub 星数，Skill 是安装量，Loop 是浏览量 */
    popularity: int('popularity', { unsigned: true }),
    /** 收录时间：主条目在采集层第一次被发现的时间 */
    firstSeenAt: at('first_seen_at').notNull(),
    /** 收录日期（北京时间），按天统计新收录用 */
    firstSeenDate: date('first_seen_date', { mode: 'string' }).notNull(),
    publishedAt: at('published_at').notNull(),
    /** 1 = 还在发布层；0 = 已不在（被合并或过滤），保留行是为了历史统计 */
    active: boolean('active').notNull().default(true),
    stClassify: tinyint('st_classify').notNull().default(1),
    stIcon: tinyint('st_icon').notNull().default(1),
    stGithub: tinyint('st_github').notNull().default(1),
    stReadme: tinyint('st_readme').notNull().default(1),
    stTranslate: tinyint('st_translate').notNull().default(1),
    stTools: tinyint('st_tools').notNull().default(1),
    stToolsTranslate: tinyint('st_tools_translate').notNull().default(1),
    stIntro: tinyint('st_intro').notNull().default(1),
    stReadmeTranslate: tinyint('st_readme_translate').notNull().default(1),
    /** 各步骤的一句话说明，例如 { icon: "原图 404", tools_translate: "12/30" } */
    notes: json('notes').$type<Record<string, string>>(),
    /** 由各状态列算出，列表筛选用 */
    failCount: tinyint('fail_count').notNull().default(0),
    warnCount: tinyint('warn_count').notNull().default(0),
    pendingCount: tinyint('pending_count').notNull().default(0),
    hasFail: boolean('has_fail').notNull().default(false),
    /** README 的缓存（AI 介绍、README 翻译的状态要用）：GitHub README 内容哈希没变就不重新读正文 */
    readmeContentHash: sha256('readme_content_hash'),
    /** 与 README 翻译任务同样算法的指纹（readme/chunk.ts readmeHash） */
    readmeHash: sha256('readme_hash'),
    /** README 正文的语言 zh / ja / en：本身是中文的不需要中文译文 */
    readmeLang: varchar('readme_lang', { length: 8 }),
    /** 去掉徽章、代码后的正文长度：不足 200 字的不生成 AI 介绍 */
    readmeChars: int('readme_chars', { unsigned: true }),
    readmeFormat: varchar('readme_format', { length: 16 }),
    seenAt: at('seen_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_admin_item_status_entity').on(t.kind, t.sourceId, t.externalId),
    index('ix_admin_item_status_list').on(t.kind, t.active, t.firstSeenAt),
    index('ix_admin_item_status_fail').on(t.kind, t.active, t.hasFail, t.firstSeenAt),
    index('ix_admin_item_status_category').on(t.kind, t.active, t.category, t.firstSeenAt),
    index('ix_admin_item_status_popular').on(t.kind, t.active, t.popularity),
    index('ix_admin_item_status_date').on(t.firstSeenDate, t.kind),
    index('ix_admin_item_status_slug').on(t.kind, t.slug),
  ],
)

/** 各类型 × 各步骤的状态计数：每次同步条目状态后重算，仪表盘的覆盖率直接读这张小表 */
export const adminCoverage = mysqlTable(
  'admin_coverage',
  {
    kind: kindCol(),
    stage: varchar('stage', { length: 24 }).notNull(),
    na: int('na', { unsigned: true }).notNull().default(0),
    pending: int('pending', { unsigned: true }).notNull().default(0),
    ok: int('ok', { unsigned: true }).notNull().default(0),
    warn: int('warn', { unsigned: true }).notNull().default(0),
    failed: int('failed', { unsigned: true }).notNull().default(0),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.stage] })],
)
