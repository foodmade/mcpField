import { sql } from 'drizzle-orm'
import { parseArgs } from 'node:util'
import { createRegistry, createStore, FACT_EXTRACTORS, type StoreKind } from '../bootstrap.ts'
import { collectDescribeInputs, DescribeRunner } from '../describe/runner.ts'
import { DescribeStore } from '../describe/store.ts'
import { DESCRIBE_KINDS, type DescribeKind } from '../describe/types.ts'
import { ClaudeDescribeWriter } from '../describe/writer.ts'
import { loadConfig } from '../config.ts'
import { CrawlEvents } from '../core/events.ts'
import { CrawlRunner, DiscoverRunner, InlineRunner, remapRecords, type RunOptions } from '../core/runner.ts'
import { isRecordSource } from '../core/store.ts'
import { assembleKit } from '../core/source.ts'
import { ENTITY_KINDS, isEntityKind, type EntityKind } from '../core/types.ts'
import { createDb } from '../db/client.ts'
import { createLogger } from '../infra/logger.ts'
import { FileStore } from '../store/file-store.ts'
import { ClaudeTranslator } from '../translate/claude-translator.ts'
import { TranslationMemory } from '../translate/memory.ts'
import { collectSources, TranslateRunner } from '../translate/runner.ts'
import { collectOverviewInputs, OverviewRunner } from '../overview/runner.ts'
import { OverviewStore } from '../overview/store.ts'
import { ClaudeOverviewWriter } from '../overview/writer.ts'
import type { ReadmeLocale } from '../readme/prompt.ts'
import { collectReadmeTargets, ReadmeTranslateRunner } from '../readme/runner.ts'
import { ReadmeTranslationStore } from '../readme/store.ts'
import { ClaudeReadmeTranslator } from '../readme/translator.ts'
import { AssetMirror, collectMediaUrls } from '../assets/mirror.ts'
import { LocalStorage, R2Storage } from '../assets/storage.ts'
import { AssetStore } from '../assets/store.ts'
import type { MediaType } from '../core/draft.ts'
import { join } from 'node:path'
import type { TextField } from '../core/draft.ts'

const HELP = `
MCP Field 数据采集

用法：npm run crawler -- <命令> [选项]

命令：
  sources                 列出已注册的数据源
  discover --source <id>  只发现并登记目标（写入 ingest_targets）
  crawl    --source <id>  发现 → 抓取 → 解析 → 映射，写入采集层
  remap    --source <id>  用当前映射逻辑重建草稿（不发网络请求，需要 MySQL）
  translate               把简介翻译成中英日三语，写入翻译记忆库（需要 MySQL 和 ANTHROPIC_API_KEY）
  overview                根据 README 生成三语介绍（概述、主要功能、适用场景、MCP 相关）
  readme                  把 README 整篇翻译成中文、日文（代码块不变，按片段去重、增量翻译）
  assets                  把图标等图片转存到 Cloudflare R2（转成 WebP），数据库只记录链接
  describe                为没有 README 的 Loop / CLI / Agent 撰写我们自己的三语内容
  stats                   查看采集层统计（需要 MySQL）

选项：
  --kind <a,b>            只处理这些类型：${ENTITY_KINDS.join(', ')}
  --limit <n>             每种类型最多处理 n 个（抽样调试）
  --since <date>          只处理站点地图 lastmod 晚于该日期的目标
  --force                 忽略增量判断，强制重新抓取和解析
  --store <mysql|file>    存储位置；默认有 DATABASE_URL 时用 mysql，否则输出到 data/runs

translate 选项：
  --kind <a,b>            要翻译的类型，默认全部
  --field <a,b>           要翻译的字段，默认 tagline,description
  --limit <n>             最多翻译 n 段原文（试跑用）
  --model <id>            模型，默认 TRANSLATE_MODEL（claude-haiku-4-5-20251001）
  --batch <n>             每次请求的条数，默认 40
  --concurrency <n>       并发请求数，默认 4
  --stale                 重翻旧版提示词的结果
  --force                 忽略已有结果全部重翻（人工译文保留）
  --recheck               按当前校验规则重新检查已有译文，只重翻不合格的

overview 选项：
  --kind <a,b>            要生成的类型，默认全部
  --limit <n>             最多生成 n 条（试跑用）
  --min-stars <n>         只给星数不低于 n 的条目生成
  --model <id>            普通条目的模型，默认 OVERVIEW_MODEL（claude-haiku-4-5-20251001）
  --premium-model <id>    热门条目的模型，默认 OVERVIEW_PREMIUM_MODEL（claude-sonnet-5-5）
  --premium-min-stars <n> 星数达到 n 算热门，默认 1000
  --batch <n>             每次请求的条数，默认 3
  --concurrency <n>       并发请求数，默认 4
  --stale / --force       重新生成旧版提示词的结果 / 全部重新生成

readme 选项：
  --kind <a,b>            要翻译的类型，默认全部
  --locale <zh,ja>        目标语言，默认 zh,ja
  --limit <n>             最多翻译 n 篇（试跑用）
  --min-stars <n>         只翻译星数不低于 n 的条目
  --licensed-only         只翻译有明确开源许可证的 README
  --model / --premium-model / --premium-min-stars   同 overview，默认 Haiku 4.5 / Sonnet 5.5 / 1000
  --concurrency <n>       并发请求数，默认 6
  --stale / --force       重翻旧版提示词的片段 / 全部重翻（人工译文保留）

describe 选项：
  --kind <loop,cli,agent> 要生成的类型，默认三种都生成
  --limit <n>             最多生成 n 条（试跑用）
  --model <id>            覆盖模型（默认 Loop 用 DESCRIBE_LOOP_MODEL，其余用 DESCRIBE_MODEL）
  --concurrency <n>       并发请求数，默认 4
  --stale / --force       重新生成旧版提示词的结果 / 全部重新生成

assets 选项：
  --kind <a,b>            要处理的类型，默认全部
  --media <icon,screenshot>  图片类型，默认 icon
  --limit <n>             最多处理 n 张（试跑用）
  --concurrency <n>       并发数，默认 8
  --store <r2|local>      存储位置；默认配置了 R2 就用 R2，否则写到 data/assets
  --force                 已转存的也重新处理
  --retry-all             不支持的格式、原图不存在的也重试
`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    kind: { type: 'string' },
    limit: { type: 'string' },
    since: { type: 'string' },
    force: { type: 'boolean', default: false },
    store: { type: 'string' },
    field: { type: 'string' },
    model: { type: 'string' },
    batch: { type: 'string' },
    concurrency: { type: 'string' },
    stale: { type: 'boolean', default: false },
    recheck: { type: 'boolean', default: false },
    'min-stars': { type: 'string' },
    'premium-model': { type: 'string' },
    'premium-min-stars': { type: 'string' },
    locale: { type: 'string' },
    'licensed-only': { type: 'boolean', default: false },
    media: { type: 'string' },
    'retry-all': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const config = loadConfig()
const logger = createLogger(config.logLevel)
const registry = createRegistry()
const command = positionals[0]

function parseKinds(value: string | undefined, supported: readonly EntityKind[]): EntityKind[] {
  if (!value) return [...supported]
  const kinds = value.split(',').map((k) => k.trim())
  const invalid = kinds.filter((k) => !isEntityKind(k) || !supported.includes(k))
  if (invalid.length) throw new Error(`不支持的类型：${invalid.join(', ')}（可用：${supported.join(', ')}）`)
  return kinds as EntityKind[]
}

async function run(mode: 'discover' | 'crawl') {
  if (!values.source) throw new Error('请用 --source 指定数据源，可用：' + registry.list().map((f) => f.meta.id).join(', '))
  const factory = registry.get(values.source)
  const storeKind = (values.store ?? (config.databaseUrl ? 'mysql' : 'file')) as StoreKind
  if (storeKind !== 'mysql' && storeKind !== 'file') throw new Error('--store 只能是 mysql 或 file')

  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.warn(`收到 ${signal}，等待进行中的任务完成后退出……`)
      controller.abort()
    })
  }

  const options: RunOptions = {
    kinds: parseKinds(values.kind, factory.meta.kinds),
    limitPerKind: values.limit ? Number(values.limit) : undefined,
    since: values.since ? new Date(values.since) : undefined,
    force: values.force,
    signal: controller.signal,
  }

  const store = createStore(storeKind, config)
  const events = new CrawlEvents()
  const ctx = { config, logger: logger.child({ source: factory.meta.id }) }
  const deps = { kit: assembleKit(factory, ctx), store, events, logger: ctx.logger }
  const runner: CrawlRunner = mode === 'discover' ? new DiscoverRunner(deps) : new InlineRunner(deps)

  events.on('parsed', (target, records, drafts) => ctx.logger.info({ kind: target.kind, id: target.externalId, records, drafts }, '已解析'))
  events.on('skipped', (target, reason) => ctx.logger.debug({ kind: target.kind, id: target.externalId, reason }, '跳过'))

  try {
    const stats = await runner.run(options)
    logger.info({ store: storeKind, ...stats }, mode === 'discover' ? '发现完成' : '抓取完成')
    if (store instanceof FileStore) logger.info(`输出目录：${store.outputDir}`)
  } finally {
    await store.close()
  }
}

async function remap() {
  if (!values.source) throw new Error('请用 --source 指定数据源')
  const factory = registry.get(values.source)
  const store = createStore('mysql', config)
  if (!isRecordSource(store)) throw new Error('当前存储不支持遍历源记录')
  const ctx = { config, logger: logger.child({ source: factory.meta.id }) }
  try {
    const stats = await remapRecords({ kit: assembleKit(factory, ctx), store, events: new CrawlEvents(), logger: ctx.logger }, parseKinds(values.kind, factory.meta.kinds))
    logger.info({ records: stats.records, drafts: stats.drafts, failed: stats.failed }, '草稿重建完成')
  } finally {
    await store.close()
  }
}

const TEXT_FIELDS: TextField[] = ['tagline', 'description']

async function translate() {
  if (!config.databaseUrl) throw new Error('translate 需要 DATABASE_URL')
  if (!config.anthropic.apiKey) throw new Error('translate 需要在 .env 中设置 ANTHROPIC_API_KEY')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const fields = (values.field?.split(',').map((f) => f.trim()) ?? TEXT_FIELDS) as TextField[]
  const invalid = fields.filter((f) => !TEXT_FIELDS.includes(f))
  if (invalid.length) throw new Error(`不支持翻译的字段：${invalid.join(', ')}（可用：${TEXT_FIELDS.join(', ')}）`)

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const translator = new ClaudeTranslator({ apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL, model: values.model ?? config.translateModel })
    const items = await collectSources(db, kinds, fields)
    const stats = await new TranslateRunner(translator, new TranslationMemory(db), logger).run(items, {
      batchSize: values.batch ? Number(values.batch) : 40,
      maxBatchChars: 8_000,
      concurrency: values.concurrency ? Number(values.concurrency) : 4,
      limit: values.limit ? Number(values.limit) : undefined,
      stale: values.stale,
      force: values.force,
      recheck: values.recheck,
      signal: controller.signal,
    })
    logger.info({ ...stats, model: translator.model }, '翻译完成')
  } finally {
    await pool.end()
  }
}

async function overview() {
  if (!config.databaseUrl) throw new Error('overview 需要 DATABASE_URL')
  if (!config.anthropic.apiKey) throw new Error('overview 需要在 .env 中设置 ANTHROPIC_API_KEY')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const claude = { apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL }
    const { inputs, skipped } = await collectOverviewInputs(db, kinds, values['min-stars'] ? Number(values['min-stars']) : 0)
    logger.info({ inputs: inputs.length, skipped }, 'README 不足或星数不够的条目已跳过')
    const runner = new OverviewRunner(
      {
        standard: new ClaudeOverviewWriter({ ...claude, model: values.model ?? config.overviewModel }),
        premium: new ClaudeOverviewWriter({ ...claude, model: values['premium-model'] ?? config.overviewPremiumModel }),
        premiumMinStars: values['premium-min-stars'] ? Number(values['premium-min-stars']) : 1000,
      },
      new OverviewStore(db),
      logger,
    )
    const stats = await runner.run(inputs, {
      batchSize: values.batch ? Number(values.batch) : 3,
      maxBatchChars: 40_000,
      concurrency: values.concurrency ? Number(values.concurrency) : 4,
      limit: values.limit ? Number(values.limit) : undefined,
      stale: values.stale,
      force: values.force,
      signal: controller.signal,
    })
    logger.info(stats, '介绍生成完成')
  } finally {
    await pool.end()
  }
}

async function readme() {
  if (!config.databaseUrl) throw new Error('readme 需要 DATABASE_URL')
  if (!config.anthropic.apiKey) throw new Error('readme 需要在 .env 中设置 ANTHROPIC_API_KEY')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const locales = (values.locale?.split(',').map((l) => l.trim()) ?? ['zh', 'ja']) as ReadmeLocale[]
  if (locales.some((l) => l !== 'zh' && l !== 'ja')) throw new Error('--locale 只支持 zh、ja（README 原文是英文）')

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const claude = { apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL }
    const { targets, skipped } = await collectReadmeTargets(db, kinds, {
      minStars: values['min-stars'] ? Number(values['min-stars']) : 0,
      licensedOnly: values['licensed-only'],
    })
    logger.info({ targets: targets.length, skipped }, '没有 README 或不符合条件的条目已跳过')
    const runner = new ReadmeTranslateRunner(
      {
        standard: new ClaudeReadmeTranslator({ ...claude, model: values.model ?? config.readmeModel }),
        premium: new ClaudeReadmeTranslator({ ...claude, model: values['premium-model'] ?? config.readmePremiumModel }),
        premiumMinStars: values['premium-min-stars'] ? Number(values['premium-min-stars']) : 1000,
      },
      new TranslationMemory(db),
      new ReadmeTranslationStore(db),
      logger,
    )
    const stats = await runner.run(targets, {
      locales,
      concurrency: values.concurrency ? Number(values.concurrency) : 6,
      limit: values.limit ? Number(values.limit) : undefined,
      stale: values.stale,
      force: values.force,
      signal: controller.signal,
    })
    logger.info(stats, 'README 翻译完成')
  } finally {
    await pool.end()
  }
}

async function describe() {
  if (!config.databaseUrl) throw new Error('describe 需要 DATABASE_URL')
  if (!config.anthropic.apiKey) throw new Error('describe 需要在 .env 中设置 ANTHROPIC_API_KEY')
  const kinds = parseKinds(values.kind, DESCRIBE_KINDS) as DescribeKind[]

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const claude = { apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL }
    const writers = new Map<string, ClaudeDescribeWriter>()
    const writerFor = (kind: DescribeKind) => {
      const model = values.model ?? (kind === 'loop' ? config.describeLoopModel : config.describeModel)
      if (!writers.has(model)) writers.set(model, new ClaudeDescribeWriter({ ...claude, model }))
      return writers.get(model)!
    }
    const inputs = await collectDescribeInputs(db, kinds, FACT_EXTRACTORS)
    const stats = await new DescribeRunner(writerFor, new DescribeStore(db, new OverviewStore(db)), logger).run(inputs, {
      limit: values.limit ? Number(values.limit) : undefined,
      stale: values.stale,
      force: values.force,
      concurrency: values.concurrency ? Number(values.concurrency) : 4,
      signal: controller.signal,
    })
    logger.info(stats, '内容生成完成')
  } finally {
    await pool.end()
  }
}

async function assets() {
  if (!config.databaseUrl) throw new Error('assets 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const media = (values.media?.split(',').map((m) => m.trim()) ?? ['icon']) as MediaType[]
  const target = values.store ?? (config.r2 ? 'r2' : 'local')
  if (target === 'r2' && !config.r2) throw new Error('使用 R2 需要在 .env 中配置 R2_ACCOUNT_ID、R2_BUCKET、R2_PUBLIC_BASE_URL、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY')
  const storage = target === 'r2' ? new R2Storage(config.r2!) : new LocalStorage(join(config.dataDir, 'assets'))

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的任务完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const items = await collectMediaUrls(db, kinds, media)
    const stats = await new AssetMirror(storage, new AssetStore(db), logger, config.userAgent).run(items, {
      concurrency: values.concurrency ? Number(values.concurrency) : 8,
      limit: values.limit ? Number(values.limit) : undefined,
      force: values.force,
      retryAll: values['retry-all'],
      signal: controller.signal,
    })
    logger.info({ ...stats, uploadedMB: +(stats.uploadedBytes / 1024 / 1024).toFixed(1) }, '图片转存完成')
  } finally {
    await pool.end()
  }
}

async function stats() {
  if (!config.databaseUrl) throw new Error('stats 需要 DATABASE_URL')
  const { db, pool } = createDb(config.databaseUrl)
  try {
    const query = async (title: string, statement: ReturnType<typeof sql>) => {
      const [rows] = (await db.execute(statement)) as unknown as [Record<string, unknown>[]]
      console.log(`\n${title}`)
      console.table(rows)
    }
    await query('目标（按类型、状态）', sql`SELECT source_id, kind, state, COUNT(*) AS n FROM ingest_targets GROUP BY source_id, kind, state ORDER BY source_id, kind, state`)
    await query('源记录与草稿', sql`SELECT r.source_id, r.kind, COUNT(*) AS records, COUNT(d.id) AS drafts, SUM(d.identity_key IS NULL) AS no_identity FROM ingest_records r LEFT JOIN ingest_drafts d ON d.record_id = r.id GROUP BY r.source_id, r.kind`)
    await query('数据质量问题', sql`SELECT code, kind, COUNT(*) AS n FROM ingest_issues GROUP BY code, kind ORDER BY n DESC`)
    await query('最近 5 次运行', sql`SELECT id, source_id, command, status, targets_discovered, docs_fetched, records_parsed, failures, started_at, finished_at FROM ingest_runs ORDER BY id DESC LIMIT 5`)
  } finally {
    await pool.end()
  }
}

async function main() {
  if (values.help || !command) return console.log(HELP)
  switch (command) {
    case 'sources':
      return console.table(registry.list().map(({ meta }) => ({ id: meta.id, name: meta.name, kinds: meta.kinds.join(','), rps: meta.politeness.requestsPerSecond })))
    case 'discover':
    case 'crawl':
      return run(command)
    case 'remap':
      return remap()
    case 'translate':
      return translate()
    case 'overview':
      return overview()
    case 'readme':
      return readme()
    case 'assets':
      return assets()
    case 'describe':
      return describe()
    case 'stats':
      return stats()
    default:
      console.log(HELP)
      process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  logger.error({ err: error instanceof Error ? error.message : String(error) }, '运行失败')
  process.exitCode = 1
})
