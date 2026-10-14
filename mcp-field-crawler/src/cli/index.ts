import { sql } from 'drizzle-orm'
import { parseArgs } from 'node:util'
import { createRegistry, createStore, FACT_EXTRACTORS, type StoreKind } from '../bootstrap.ts'
import { collectDescribeInputs, DescribeRunner } from '../describe/runner.ts'
import { DescribeStore } from '../describe/store.ts'
import { DESCRIBE_KINDS, type DescribeKind } from '../describe/types.ts'
import { LlmDescribeWriter } from '../describe/writer.ts'
import { loadConfig } from '../config.ts'
import { CrawlEvents } from '../core/events.ts'
import { CrawlRunner, DiscoverRunner, InlineRunner, remapRecords, type RunOptions } from '../core/runner.ts'
import { isRecordSource } from '../core/store.ts'
import { assembleKit } from '../core/source.ts'
import { ENTITY_KINDS, isEntityKind, type EntityKind } from '../core/types.ts'
import { createDb } from '../db/client.ts'
import { createLogger } from '../infra/logger.ts'
import { FileStore } from '../store/file-store.ts'
import { GithubClient } from '../github/client.ts'
import { GithubReadmeFetcher } from '../github/readme.ts'
import { GithubRepoFetcher } from '../github/repo.ts'
import { collectGithubTargets, GithubReadmeRunner, GithubRepoRunner } from '../github/runner.ts'
import { GithubReadmeStore, GithubRepoStore } from '../github/store.ts'
import { LlmTranslator } from '../translate/claude-translator.ts'
import type { LlmConfig, LlmProvider } from '../llm/provider.ts'
import { TranslationMemory } from '../translate/memory.ts'
import { collectSources, TranslateRunner } from '../translate/runner.ts'
import { collectOverviewInputs, OverviewRunner } from '../overview/runner.ts'
import { OverviewStore } from '../overview/store.ts'
import { LlmOverviewWriter } from '../overview/writer.ts'
import type { ReadmeLocale } from '../readme/prompt.ts'
import { collectReadmeTargets, loadReadmes, ReadmeTranslateRunner } from '../readme/runner.ts'
import { ReadmeTranslationStore } from '../readme/store.ts'
import { LlmReadmeTranslator } from '../readme/translator.ts'
import { AssetMirror, collectMediaUrls } from '../assets/mirror.ts'
import { LocalStorage, R2Storage } from '../assets/storage.ts'
import { AssetStore } from '../assets/store.ts'
import { applySkillIcons, skillsWithoutIcon } from '../assets/skill-icons.ts'
import { runMergePlan } from '../merge/runner.ts'
import { publish } from '../merge/publish.ts'
import { syncSearchIndex } from '../search/sync.ts'
import { LlmClassifier } from '../classify/classifier.ts'
import { ClassifyRunner, collectClassifyInputs } from '../classify/runner.ts'
import { ClassificationStore } from '../classify/store.ts'
import { importSkillsShReadmes } from '../sources/skills-sh/readme.ts'
import type { MediaType } from '../core/draft.ts'
import { join } from 'node:path'
import type { TextField } from '../core/draft.ts'

/** Loop / CLI / Agent 的介绍由 describe 撰写，overview 不生成，避免覆盖 */
const OVERVIEW_KINDS = ENTITY_KINDS.filter((k) => !(DESCRIBE_KINDS as readonly EntityKind[]).includes(k))

const HELP = `
MCP Field 数据采集

用法：npm run crawler -- <命令> [选项]

命令：
  sources                 列出已注册的数据源
  discover --source <id>  只发现并登记目标（写入 ingest_targets）
  crawl    --source <id>  发现 → 抓取 → 解析 → 映射，写入采集层
  remap    --source <id>  用当前映射逻辑重建草稿（不发网络请求，需要 MySQL）
  github                  从 GitHub 更新星数和最近提交时间，并抓取 README（Skill 取 SKILL.md）；README 只用 GitHub 的
  translate               把简介翻译成中英日三语，写入翻译记忆库（需要 MySQL 和 ANTHROPIC_API_KEY）
  overview                根据 README 生成三语介绍（概述、主要功能、适用场景、MCP 相关）；Loop / CLI / Agent 由 describe 撰写
  readme                  把 README 整篇翻译成中文、日文（代码块不变，按片段去重、增量翻译）
  assets                  把图标等图片转存到 Cloudflare R2（转成 WebP），数据库只记录链接
  skill-icons             补全 Skill 图标：GitHub 仓库所有者的头像转存到 R2，写入发布层（之后 publish 也会保留）
  describe                为没有 README 的 Loop / CLI / Agent 撰写我们自己的三语内容
  merge-plan              合并预演：按身份键算出哪些草稿是同一个东西，只读，报告写到 data/merge-plan
  classify                给来源没有分类的条目分类（按 classify/taxonomy.ts 的分类体系），之后 publish 写入发布层
  publish                 发布：过滤凑数条目，把各来源的同一个东西合并成一条，重建 ingest_published（网站和各生成任务读它）
  search-index            同步搜索表 ingest_search（关键词搜索和热门列表用）；publish / github / translate / describe 结束时自动同步
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
  --model <id>            模型，默认 TRANSLATE_MODEL（claude-haiku-5-5）；TRANSLATE_PROVIDER=openai 时走 OpenAI 兼容接口（README 翻译同样适用）
  --batch <n>             每次请求的条数，默认 40
  --concurrency <n>       并发请求数，默认 4
  --stale                 重翻旧版提示词的结果
  --force                 忽略已有结果全部重翻（人工译文保留）
  --recheck               按当前校验规则重新检查已有译文，只重翻不合格的

github 选项：
  --kind <a,b>            要处理的类型，默认全部（有 GitHub 仓库的条目）
  --limit <n>             统计、README 各最多处理 n 个仓库（试跑用）
  --concurrency <n>       README 并发请求数，默认 4（统计用 GraphQL，每批 50 个仓库、并发 2）
  --force                 README 忽略下次检查时间和 ETag，全部重新请求（统计每次都全部更新）

overview 选项：
  --kind <a,b>            要生成的类型，默认 ${OVERVIEW_KINDS.join(', ')}
  --limit <n>             最多生成 n 条（试跑用）
  --min-stars <n>         只给星数不低于 n 的条目生成
  --model <id>            普通条目的模型，默认 OVERVIEW_MODEL（claude-haiku-5-5）；OVERVIEW_PROVIDER=openai 时走 OpenAI 兼容接口
  --premium-model <id>    热门条目单独用的模型，默认 OVERVIEW_PREMIUM_MODEL；都不设置时不分档，全部用 --model
  --premium-min-stars <n> 设置了热门模型时，星数达到 n 算热门，默认 1000
  --batch <n>             每次请求的条数，默认 3
  --concurrency <n>       并发请求数，默认 4
  --stale / --force       重新生成旧版提示词的结果 / 全部重新生成

readme 选项：
  --kind <a,b>            要翻译的类型，默认全部
  --locale <zh,ja>        目标语言，默认 zh,ja
  --limit <n>             最多翻译 n 篇（试跑用）
  --min-stars <n>         只翻译星数不低于 n 的条目
  --licensed-only         只翻译有明确开源许可证的 README
  --model / --premium-model / --premium-min-stars   同 overview，默认 Haiku 5.5 / 不分档 / 1000
  --concurrency <n>       并发请求数，默认 TRANSLATE_CONCURRENCY，没有设置时 6
  --stale / --force       重翻旧版提示词的片段 / 全部重翻（人工译文保留）

describe 选项：
  --kind <loop,cli,agent> 要生成的类型，默认三种都生成
  --limit <n>             最多生成 n 条（试跑用）
  --model <id>            覆盖模型（默认 Loop 用 DESCRIBE_LOOP_MODEL，其余用 DESCRIBE_MODEL）
  --concurrency <n>       并发请求数，默认 4
  --stale / --force       重新生成旧版提示词的结果 / 全部重新生成

classify 选项：
  --kind <a,b>            要分类的类型，默认全部
  --limit <n>             最多分类 n 条（试跑用）
  --all                   连来源已经有分类的也分类（用来和源站分类对比评估；发布时仍以来源的为准）
  --model <id>            模型，默认 CLASSIFY_MODEL（claude-opus-5-5）；CLASSIFY_PROVIDER=openai 时走 OpenAI 兼容接口
  --batch <n>             每次请求的条数，默认 25
  --concurrency <n>       并发请求数，默认 4（代理网关有每用户并发上限，和其他任务共用）
  --force                 忽略已有结果全部重新分类

assets 选项：
  --kind <a,b>            要处理的类型，默认全部
  --media <icon,screenshot>  图片类型，默认 icon
  --source <id>           只处理该数据源草稿里的图片，默认全部
  --limit <n>             最多处理 n 张（试跑用）
  --concurrency <n>       并发数，默认 8
  --store <r2|local>      存储位置；默认配置了 R2 就用 R2，否则写到 data/assets
  --force                 已转存的也重新处理
  --retry-all             不支持的格式、原图不存在的也重试

skill-icons 选项：
  --limit / --concurrency / --store / --force / --retry-all   同 assets（--limit 按头像张数计）
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
    all: { type: 'boolean', default: false },
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

async function github() {
  if (!config.databaseUrl) throw new Error('github 需要 DATABASE_URL')
  if (!config.githubToken) logger.warn('没有设置 GITHUB_TOKEN，GitHub 接口每小时只能请求 60 次')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const { readmes, repos } = await collectGithubTargets(db, kinds)
    const client = new GithubClient({ token: config.githubToken, userAgent: config.userAgent, logger })
    const limit = values.limit ? Number(values.limit) : undefined
    const repoStats = await new GithubRepoRunner(new GithubRepoFetcher(client), new GithubRepoStore(db), logger).run(repos, { batchSize: 50, concurrency: 2, limit, signal: controller.signal })
    logger.info(repoStats, 'GitHub 仓库统计更新完成')
    if (controller.signal.aborted) return
    // skills.sh 已经给出 SKILL.md 的 Skill 直接导入，不再请求 GitHub
    const readmeStore = new GithubReadmeStore(db)
    logger.info(await importSkillsShReadmes(db, readmeStore, readmes), 'skills.sh 的 SKILL.md 已导入')
    const readmeStats = await new GithubReadmeRunner(new GithubReadmeFetcher(client), readmeStore, logger).run(readmes, {
      concurrency: values.concurrency ? Number(values.concurrency) : 4,
      force: values.force,
      limit,
      signal: controller.signal,
    })
    logger.info(readmeStats, 'GitHub README 抓取完成')
    // 星数变了，热门顺序跟着变
    if (!controller.signal.aborted) await syncSearchIndex(db, kinds, logger)
  } finally {
    await pool.end()
  }
}

const TEXT_FIELDS: TextField[] = ['tagline', 'description']

async function translate() {
  if (!config.databaseUrl) throw new Error('translate 需要 DATABASE_URL')
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
    const translator = new LlmTranslator({ ...translateLlm(), model: values.model ?? config.translateModel })
    const items = await collectSources(db, kinds, fields)
    const stats = await new TranslateRunner(translator, new TranslationMemory(db), logger).run(items, {
      batchSize: values.batch ? Number(values.batch) : 40,
      maxBatchChars: 8_000,
      concurrency: values.concurrency ? Number(values.concurrency) : (config.translateConcurrency ?? 4),
      limit: values.limit ? Number(values.limit) : undefined,
      stale: values.stale,
      force: values.force,
      recheck: values.recheck,
      signal: controller.signal,
    })
    logger.info({ ...stats, model: translator.model }, '翻译完成')
    // 新译文要能搜到
    if (!controller.signal.aborted) await syncSearchIndex(db, kinds, logger)
  } finally {
    await pool.end()
  }
}

async function overview() {
  if (!config.databaseUrl) throw new Error('overview 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, OVERVIEW_KINDS)

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const llm = llmConfig(config.overviewProvider)
    const { inputs, skipped } = await collectOverviewInputs(db, kinds, values['min-stars'] ? Number(values['min-stars']) : 0)
    logger.info({ inputs: inputs.length, skipped }, 'README 不足或星数不够的条目已跳过')
    const model = values.model ?? config.overviewModel
    const premiumModel = values['premium-model'] ?? config.overviewPremiumModel
    const runner = new OverviewRunner(
      {
        standard: new LlmOverviewWriter({ ...llm, model }),
        // 只有单独设置了热门模型（且与普通模型不同）时才按星数分档
        premium: premiumModel && premiumModel !== model ? new LlmOverviewWriter({ ...llm, model: premiumModel }) : undefined,
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
    const llm = translateLlm()
    const { targets, skipped } = await collectReadmeTargets(db, kinds, {
      minStars: values['min-stars'] ? Number(values['min-stars']) : 0,
      licensedOnly: values['licensed-only'],
    })
    logger.info({ targets: targets.length, skipped }, '没有 README 或不符合条件的条目已跳过')
    const model = values.model ?? config.readmeModel
    const premiumModel = values['premium-model'] ?? config.readmePremiumModel
    const runner = new ReadmeTranslateRunner(
      {
        standard: new LlmReadmeTranslator({ ...llm, model }),
        premium: premiumModel && premiumModel !== model ? new LlmReadmeTranslator({ ...llm, model: premiumModel }) : undefined,
        premiumMinStars: values['premium-min-stars'] ? Number(values['premium-min-stars']) : 1000,
      },
      new TranslationMemory(db),
      new ReadmeTranslationStore(db),
      logger,
      (slice) => loadReadmes(new GithubReadmeStore(db), slice),
    )
    const stats = await runner.run(targets, {
      locales,
      concurrency: values.concurrency ? Number(values.concurrency) : (config.translateConcurrency ?? 6),
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
  const kinds = parseKinds(values.kind, DESCRIBE_KINDS) as DescribeKind[]

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const llm = llmConfig(config.describeProvider)
    const writers = new Map<string, LlmDescribeWriter>()
    const writerFor = (kind: DescribeKind) => {
      const model = values.model ?? (kind === 'loop' ? config.describeLoopModel : config.describeModel)
      if (!writers.has(model)) writers.set(model, new LlmDescribeWriter({ ...llm, model }))
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
    // 新撰写的简介要能搜到
    if (!controller.signal.aborted) await syncSearchIndex(db, kinds, logger)
  } finally {
    await pool.end()
  }
}

/** 图片存储：--store 指定，默认配置了 R2 就用 R2，否则写到 data/assets */
function assetStorage() {
  const target = values.store ?? (config.r2 ? 'r2' : 'local')
  if (target === 'r2' && !config.r2) throw new Error('使用 R2 需要在 .env 中配置 R2_ACCOUNT_ID、R2_BUCKET、R2_PUBLIC_BASE_URL、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY')
  return target === 'r2' ? new R2Storage(config.r2!) : new LocalStorage(join(config.dataDir, 'assets'))
}

function mirrorOptions(signal: AbortSignal) {
  return {
    concurrency: values.concurrency ? Number(values.concurrency) : 8,
    limit: values.limit ? Number(values.limit) : undefined,
    force: values.force,
    retryAll: values['retry-all'],
    signal,
  }
}

async function assets() {
  if (!config.databaseUrl) throw new Error('assets 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const media = (values.media?.split(',').map((m) => m.trim()) ?? ['icon']) as MediaType[]
  const storage = assetStorage()

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的任务完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const items = await collectMediaUrls(db, kinds, media, values.source)
    const stats = await new AssetMirror(storage, new AssetStore(db), logger, config.userAgent).run(items, mirrorOptions(controller.signal))
    logger.info({ ...stats, uploadedMB: +(stats.uploadedBytes / 1024 / 1024).toFixed(1) }, '图片转存完成')
  } finally {
    await pool.end()
  }
}

async function skillIcons() {
  if (!config.databaseUrl) throw new Error('skill-icons 需要 DATABASE_URL')
  const storage = assetStorage()

  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的任务完成后退出……')
    controller.abort()
  })

  const { db, pool } = createDb(config.databaseUrl)
  try {
    const store = new AssetStore(db)
    const skills = await skillsWithoutIcon(db)
    const avatars = [...new Set(skills.map((s) => s.url))]
    logger.info({ skills: skills.length, owners: avatars.length }, '没有图标的 Skill')
    const stats = await new AssetMirror(storage, store, logger, config.userAgent).run(
      avatars.map((url) => ({ url, type: 'icon' as const })),
      mirrorOptions(controller.signal),
    )
    // 中断时也写入：已经转存成功的头像不白做
    const applied = await applySkillIcons(db, store, skills)
    logger.info({ ...stats, uploadedMB: +(stats.uploadedBytes / 1024 / 1024).toFixed(1), applied }, 'Skill 图标补全完成')
  } finally {
    await pool.end()
  }
}

async function mergePlan() {
  if (!config.databaseUrl) throw new Error('merge-plan 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const { db, pool } = createDb(config.databaseUrl)
  try {
    const { file, summary, merged, plan } = await runMergePlan(db, kinds, join(config.dataDir, 'merge-plan'))
    console.log('\n各类型合并结果')
    console.table(summary.kinds.map(({ bySources, ...rest }) => ({ ...rest, bySources: JSON.stringify(bySources) })))
    console.log(`\n跨类型相关（同一强键出现在多个类型）：${summary.related}`)
    console.log('\n最大的合并组')
    console.table(merged.slice(0, 15).map((g) => ({ kind: g.kind, key: g.key, n: g.members.length, nameMismatch: g.nameMismatch, members: g.members.map((m) => m.externalId).join(', ').slice(0, 100) })))
    console.log('\n有歧义、未用于合并的键（前 15 个）')
    console.table(plan.ambiguous.slice(0, 15).map((a) => ({ kind: a.kind, key: a.key, groups: a.groups.length, reason: a.reason.slice(0, 100) })))
    logger.info({ file }, '合并预演完成，报告已写入')
  } finally {
    await pool.end()
  }
}

/** 按配置的模型服务取连接参数：openai / minimax 走各自的 OpenAI 兼容接口，claude 走 Anthropic */
function llmConfig(provider: LlmProvider): LlmConfig {
  if (provider === 'qwen') {
    if (!config.qwen.apiKey) throw new Error('使用 qwen 模型服务需要 QWEN_API_KEY')
    return { provider, apiKey: config.qwen.apiKey, baseURL: config.qwen.baseURL }
  }
  if (provider === 'opencode') {
    if (!config.opencode.apiKey) throw new Error('使用 opencode 模型服务需要 OPENCODE_API_KEY')
    return { provider, apiKey: config.opencode.apiKey, baseURL: config.opencode.baseURL }
  }
  if (provider === 'minimax') {
    if (!config.minimax.apiKey) throw new Error('使用 minimax 模型服务需要 MINIMAX_API_KEY')
    return { provider, apiKey: config.minimax.apiKey, baseURL: config.minimax.baseURL }
  }
  if (provider === 'openai') {
    if (!config.openai.apiKey) throw new Error('使用 openai 模型服务需要 OPENAI_API_KEY（和 OPENAI_BASE_URL）')
    return { provider: 'openai', apiKey: config.openai.apiKey, baseURL: config.openai.baseURL }
  }
  if (!config.anthropic.apiKey) throw new Error('使用 claude 模型服务需要 ANTHROPIC_API_KEY')
  return { provider: 'claude', apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL }
}

/** 翻译（简介、README）用的模型服务：TRANSLATE_PROVIDER、TRANSLATE_REASONING_EFFORT */
const translateLlm = (): LlmConfig => ({ ...llmConfig(config.translateProvider), reasoningEffort: config.translateReasoningEffort })

async function classify() {
  if (!config.databaseUrl) throw new Error('classify 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const controller = new AbortController()
  process.once('SIGINT', () => {
    logger.warn('收到中断信号，等待进行中的请求完成后退出……')
    controller.abort()
  })
  const { db, pool } = createDb(config.databaseUrl)
  try {
    const classifier = new LlmClassifier({ ...llmConfig(config.classifyProvider), model: values.model ?? config.classifyModel })
    const inputs = await collectClassifyInputs(db, kinds, { all: values.all })
    const stats = await new ClassifyRunner(classifier, new ClassificationStore(db), logger).run(inputs, {
      limit: values.limit ? Number(values.limit) : undefined,
      force: values.force,
      batchSize: values.batch ? Number(values.batch) : 25,
      maxBatchChars: 40_000,
      concurrency: values.concurrency ? Number(values.concurrency) : 4,
      signal: controller.signal,
    })
    logger.info(stats, '分类完成（运行 publish 后在网站上生效）')
  } finally {
    await pool.end()
  }
}

async function publishCommand() {
  if (!config.databaseUrl) throw new Error('publish 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const { db, pool } = createDb(config.databaseUrl)
  try {
    const stats = await publish(db, kinds, logger)
    logger.info(stats, '发布完成')
    await syncSearchIndex(db, kinds, logger)
  } finally {
    await pool.end()
  }
}

async function searchIndex() {
  if (!config.databaseUrl) throw new Error('search-index 需要 DATABASE_URL')
  const kinds = parseKinds(values.kind, ENTITY_KINDS)
  const { db, pool } = createDb(config.databaseUrl)
  try {
    await syncSearchIndex(db, kinds, logger)
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
    await query('补全结果', sql`SELECT enricher, status, COUNT(*) AS n FROM ingest_enrichments GROUP BY enricher, status ORDER BY enricher, status`)
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
    case 'github':
      return github()
    case 'translate':
      return translate()
    case 'overview':
      return overview()
    case 'readme':
      return readme()
    case 'assets':
      return assets()
    case 'skill-icons':
      return skillIcons()
    case 'describe':
      return describe()
    case 'merge-plan':
      return mergePlan()
    case 'classify':
      return classify()
    case 'publish':
      return publishCommand()
    case 'search-index':
      return searchIndex()
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
