import { bigint, boolean, foreignKey, index, int, json, mediumtext, mysqlTable, primaryKey, smallint, text, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import { entities } from './catalog.ts'
import { at, kindCol, localeCol, pk, ref, sha256, sourceIdCol, timestamps } from './columns.ts'

/*
 * 采集层（ingest_*）：只有采集服务读写，网站不直接读取。
 * 数据按"目标 → 原始文档 → 源记录 → 草稿 → 问题"逐层落地，每一层都能单独重跑：
 *   ingest_targets   待抓取的地址（同时是任务队列）
 *   ingest_documents 每次抓取的记录，正文压缩后存在文件存储里
 *   ingest_records   源站原生结构的数据（JSON），解析器版本变化时可从原文重新解析
 *   ingest_drafts    统一结构的细粒度草稿（JSON），发布阶段据此写入目录表
 *   ingest_issues    数据质量问题，按 code 汇总排查
 *   ingest_published 按身份键合并后的条目（每组一行），网站和各生成任务读这张表
 */

const cascade = { onDelete: 'cascade' } as const
const setNull = { onDelete: 'set null' } as const

export const ingestSources = mysqlTable('ingest_sources', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  homepage: varchar('homepage', { length: 512 }).notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  politeness: json('politeness'),
  ...timestamps(),
})

const sourceRef = () => sourceIdCol().notNull().references(() => ingestSources.id)

export const ingestRuns = mysqlTable(
  'ingest_runs',
  {
    id: pk(),
    sourceId: sourceRef(),
    /** discover / crawl / enrich / publish */
    command: varchar('command', { length: 16 }).notNull(),
    options: json('options'),
    /** running / succeeded / failed */
    status: varchar('status', { length: 16 }).notNull().default('running'),
    targetsDiscovered: int('targets_discovered', { unsigned: true }).notNull().default(0),
    targetsSkipped: int('targets_skipped', { unsigned: true }).notNull().default(0),
    docsFetched: int('docs_fetched', { unsigned: true }).notNull().default(0),
    docsNotModified: int('docs_not_modified', { unsigned: true }).notNull().default(0),
    docsUnchanged: int('docs_unchanged', { unsigned: true }).notNull().default(0),
    recordsParsed: int('records_parsed', { unsigned: true }).notNull().default(0),
    draftsMapped: int('drafts_mapped', { unsigned: true }).notNull().default(0),
    failures: int('failures', { unsigned: true }).notNull().default(0),
    error: text('error'),
    host: varchar('host', { length: 128 }),
    pid: int('pid', { unsigned: true }),
    startedAt: at('started_at').notNull(),
    finishedAt: at('finished_at'),
  },
  (t) => [index('ix_ingest_runs_source_started').on(t.sourceId, t.startedAt)],
)

/** URL 前沿兼任务队列：Worker 用 SELECT … FOR UPDATE SKIP LOCKED 领取到期目标 */
export const ingestTargets = mysqlTable(
  'ingest_targets',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: sha256('url_hash').notNull(),
    sitemapLastmod: at('sitemap_lastmod'),
    priority: smallint('priority').notNull().default(0),
    /** pending / fetched / not_modified / failed / gone（404/410）/ blocked（robots 禁止） */
    state: varchar('state', { length: 16 }).notNull().default('pending'),
    httpStatus: smallint('http_status', { unsigned: true }),
    etag: varchar('etag', { length: 255 }),
    lastModified: varchar('last_modified', { length: 64 }),
    contentHash: sha256('content_hash'),
    failCount: smallint('fail_count', { unsigned: true }).notNull().default(0),
    lastError: varchar('last_error', { length: 1024 }),
    discoveredAt: at('discovered_at').notNull(),
    lastSeenAt: at('last_seen_at').notNull(),
    fetchedAt: at('fetched_at'),
    nextFetchAt: at('next_fetch_at'),
    lockedBy: varchar('locked_by', { length: 64 }),
    lockedUntil: at('locked_until'),
    lastRunId: ref('last_run_id').references(() => ingestRuns.id, setNull),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_ingest_targets_url').on(t.sourceId, t.urlHash),
    uniqueIndex('uq_ingest_targets_external').on(t.sourceId, t.kind, t.externalId),
    index('ix_ingest_targets_queue').on(t.state, t.nextFetchAt),
    index('ix_ingest_targets_source_kind_state').on(t.sourceId, t.kind, t.state),
  ],
)

/** 抓取历史：每次请求一行；正文按内容哈希存在文件存储，内容不变时不重复存 */
export const ingestDocuments = mysqlTable(
  'ingest_documents',
  {
    id: pk(),
    targetId: ref('target_id').notNull().references(() => ingestTargets.id, cascade),
    runId: ref('run_id').references(() => ingestRuns.id, setNull),
    requestedUrl: varchar('requested_url', { length: 2048 }).notNull(),
    finalUrl: varchar('final_url', { length: 2048 }).notNull(),
    httpStatus: smallint('http_status', { unsigned: true }).notNull(),
    contentType: varchar('content_type', { length: 128 }),
    bytes: int('bytes', { unsigned: true }).notNull().default(0),
    contentHash: sha256('content_hash'),
    blobKey: varchar('blob_key', { length: 512 }),
    notModified: boolean('not_modified').notNull().default(false),
    durationMs: int('duration_ms', { unsigned: true }),
    fetchedAt: at('fetched_at').notNull(),
  },
  (t) => [index('ix_ingest_documents_target_time').on(t.targetId, t.fetchedAt), index('ix_ingest_documents_run').on(t.runId)],
)

export const ingestRecords = mysqlTable(
  'ingest_records',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    targetId: ref('target_id').references(() => ingestTargets.id, setNull),
    url: varchar('url', { length: 2048 }).notNull(),
    parserVersion: smallint('parser_version', { unsigned: true }).notNull(),
    contentHash: sha256('content_hash').notNull(),
    data: json('data').notNull(),
    fetchedAt: at('fetched_at').notNull(),
    parsedAt: at('parsed_at').notNull(),
    /** 数据内容最近一次发生变化的时间 */
    changedAt: at('changed_at').notNull(),
  },
  (t) => [uniqueIndex('uq_ingest_records_external').on(t.sourceId, t.kind, t.externalId)],
)

export const ingestDrafts = mysqlTable(
  'ingest_drafts',
  {
    id: pk(),
    recordId: ref('record_id').notNull().references(() => ingestRecords.id, cascade).unique('uq_ingest_drafts_record'),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    identityKey: varchar('identity_key', { length: 255 }),
    mapperVersion: smallint('mapper_version', { unsigned: true }).notNull(),
    draftHash: sha256('draft_hash').notNull(),
    draft: json('draft').notNull(),
    /** 发布阶段合并到的目录实体 */
    entityId: ref('entity_id').references(() => entities.id, setNull),
    mappedAt: at('mapped_at').notNull(),
    publishedAt: at('published_at'),
  },
  (t) => [index('ix_ingest_drafts_identity').on(t.identityKey), index('ix_ingest_drafts_entity').on(t.entityId)],
)

/** 数据质量问题：每次映射时重建；例如 SELECT code, COUNT(*) FROM ingest_issues GROUP BY code */
export const ingestIssues = mysqlTable(
  'ingest_issues',
  {
    id: pk(),
    draftId: ref('draft_id').notNull().references(() => ingestDrafts.id, cascade),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    code: varchar('code', { length: 48 }).notNull(),
    detail: varchar('detail', { length: 1024 }),
    runId: ref('run_id').references(() => ingestRuns.id, setNull),
    createdAt: at('created_at').notNull(),
  },
  (t) => [index('ix_ingest_issues_code').on(t.code), index('ix_ingest_issues_external').on(t.sourceId, t.kind, t.externalId)],
)

/** 补全阶段的缓存：GitHub / 官方 Registry / npm / PyPI / 实时探测的原始响应 */
export const ingestEnrichments = mysqlTable(
  'ingest_enrichments',
  {
    id: pk(),
    /** github / registry / npm / pypi / probe */
    enricher: varchar('enricher', { length: 32 }).notNull(),
    /** 例如 repo:github.com/microsoft/playwright-mcp、npm:@playwright/mcp */
    subjectKey: varchar('subject_key', { length: 255 }).notNull(),
    /** ok / not_found / auth_required / error */
    status: varchar('status', { length: 16 }).notNull(),
    httpStatus: smallint('http_status', { unsigned: true }),
    etag: varchar('etag', { length: 255 }),
    contentHash: sha256('content_hash'),
    data: json('data'),
    error: varchar('error', { length: 1024 }),
    fetchedAt: at('fetched_at').notNull(),
    expiresAt: at('expires_at'),
  },
  (t) => [uniqueIndex('uq_ingest_enrichments_subject').on(t.enricher, t.subjectKey), index('ix_ingest_enrichments_expiry').on(t.expiresAt)],
)

/* ========== 翻译记忆库：按原文内容去重，同样的原文只翻一次 ========== */

/** 需要翻译的原文，主键是规范化原文的 SHA-256 */
export const ingestTranslationSources = mysqlTable('ingest_translation_sources', {
  hash: sha256('hash').primaryKey(),
  /** 简介或 README 片段，片段可能较长 */
  text: mediumtext('text').notNull(),
  charCount: int('char_count', { unsigned: true }).notNull(),
  /** 模型识别出的原文语言：zh / en / ja / other */
  sourceLocale: varchar('source_locale', { length: 8 }),
  createdAt: at('created_at').notNull(),
})

/** 译文：一行 = 一段原文的一种语言 */
export const ingestTranslations = mysqlTable(
  'ingest_translations',
  {
    id: pk(),
    sourceHash: sha256('source_hash').notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    content: mediumtext('content').notNull(),
    /** source：目标语言就是原文语言（只做了清理）/ translated：机器翻译 / manual：人工修改，自动翻译不会覆盖 */
    origin: varchar('origin', { length: 16 }).notNull(),
    /** ok：通过校验 / review：有软性问题，可用但需要抽查 */
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    problems: json('problems'),
    provider: varchar('provider', { length: 32 }),
    model: varchar('model', { length: 64 }),
    promptVersion: smallint('prompt_version', { unsigned: true }),
    ...timestamps(),
  },
  (t) => [
    // MySQL 标识符最长 64 个字符，drizzle 自动生成的外键名会超长，这里显式命名
    foreignKey({ name: 'fk_ingest_translations_source', columns: [t.sourceHash], foreignColumns: [ingestTranslationSources.hash] }).onDelete('cascade'),
    uniqueIndex('uq_ingest_translations_locale').on(t.sourceHash, t.locale),
    index('ix_ingest_translations_status').on(t.status),
  ],
)

/**
 * 翻译失败记录：内容上多次重做仍不合格的片段（校验不过、没按格式返回、输出被截断；超时、限流等请求错误不算）。
 * README 翻译默认跳过这些片段，免得每次运行都在开头反复重试；整个任务跑完后用 readme --retry-failed 专门重跑
 */
export const ingestTranslationFailures = mysqlTable(
  'ingest_translation_failures',
  {
    id: pk(),
    sourceHash: sha256('source_hash').notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    failures: smallint('failures', { unsigned: true }).notNull().default(1),
    /** 最近一次失败的原因：校验问题代码或错误名 */
    reason: varchar('reason', { length: 255 }),
    model: varchar('model', { length: 64 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_translation_failures').on(t.sourceHash, t.locale)],
)

/* ========== AI 生成的三语介绍：根据 README 和项目信息生成，每个条目每种语言一行 ========== */

export const ingestOverviews = mysqlTable(
  'ingest_overviews',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    locale: localeCol(),
    /** 2–3 句概述 */
    summary: text('summary').notNull(),
    /** 与 MCP 的关系；README 没提到时为空 */
    mcpNote: text('mcp_note'),
    /** 生成时输入（名称、简介、分类、README）的指纹：输入不变就不重复生成 */
    inputHash: sha256('input_hash').notNull(),
    provider: varchar('provider', { length: 32 }),
    model: varchar('model', { length: 64 }),
    promptVersion: smallint('prompt_version', { unsigned: true }),
    /** ok / review */
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    problems: json('problems'),
    generatedAt: at('generated_at').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_overviews_entity').on(t.sourceId, t.kind, t.externalId, t.locale), index('ix_ingest_overviews_status').on(t.status)],
)

/** 介绍里的列表项：主要功能、适用场景，一条一行 */
export const ingestOverviewItems = mysqlTable(
  'ingest_overview_items',
  {
    id: pk(),
    overviewId: ref('overview_id').notNull(),
    /** feature / use_case */
    list: varchar('list', { length: 16 }).notNull(),
    position: smallint('position').notNull(),
    text: varchar('text', { length: 1024 }).notNull(),
  },
  (t) => [
    foreignKey({ name: 'fk_ingest_overview_items_overview', columns: [t.overviewId], foreignColumns: [ingestOverviews.id] }).onDelete('cascade'),
    uniqueIndex('uq_ingest_overview_items_pos').on(t.overviewId, t.list, t.position),
  ],
)

/* ========== README 整篇译文：由翻译记忆库里的片段译文拼成，每个条目每种语言一行 ========== */

export const ingestReadmeTranslations = mysqlTable(
  'ingest_readme_translations',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    locale: localeCol(),
    /** 翻译时 README 原文的指纹：与当前原文不一致说明原文已更新 */
    readmeHash: sha256('readme_hash').notNull(),
    content: mediumtext('content').notNull(),
    chunkCount: smallint('chunk_count', { unsigned: true }).notNull(),
    /** 实际翻译的片段数（只有代码、徽章的片段不翻译） */
    translatedChunks: smallint('translated_chunks', { unsigned: true }).notNull(),
    /** 用到的模型，逗号分隔 */
    models: varchar('models', { length: 255 }),
    promptVersion: smallint('prompt_version', { unsigned: true }),
    /** ok / review：任一片段待抽查，整篇即为 review */
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    reviewChunks: smallint('review_chunks', { unsigned: true }).notNull().default(0),
    /** 原项目许可证（来自源站） */
    license: varchar('license', { length: 64 }),
    translatedAt: at('translated_at').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_readme_translations').on(t.sourceId, t.kind, t.externalId, t.locale), index('ix_ingest_readme_translations_status').on(t.status)],
)

/* ========== 我们自己撰写的内容：没有可用 README 的条目（Loop、CLI、Agent）由 AI 根据事实生成 ========== */

const generatedMeta = () => ({
  /** 生成时输入（事实 + 参考）的指纹：输入不变就不重复生成 */
  inputHash: sha256('input_hash').notNull(),
  provider: varchar('provider', { length: 32 }),
  model: varchar('model', { length: 64 }),
  promptVersion: smallint('prompt_version', { unsigned: true }),
  /** ok / review */
  status: varchar('status', { length: 16 }).notNull().default('ok'),
  problems: json('problems'),
  generatedAt: at('generated_at').notNull(),
})

/** 短文本：一行 = 一个条目的一个字段的一种语言（tagline / goal / exit_condition） */
export const ingestGeneratedTexts = mysqlTable(
  'ingest_generated_texts',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    locale: localeCol(),
    field: varchar('field', { length: 24 }).notNull(),
    content: text('content').notNull(),
    ...generatedMeta(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_generated_texts').on(t.sourceId, t.kind, t.externalId, t.locale, t.field), index('ix_ingest_generated_texts_field').on(t.kind, t.field)],
)

/** Loop 的步骤：一行 = 一个步骤的一种语言；command 是源数据里的事实（可执行命令），各语言相同 */
export const ingestGeneratedSteps = mysqlTable(
  'ingest_generated_steps',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    locale: localeCol(),
    position: smallint('position').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    command: varchar('command', { length: 1024 }),
    ...generatedMeta(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_generated_steps').on(t.sourceId, t.kind, t.externalId, t.locale, t.position)],
)

/**
 * 发布层：按身份键把各来源的草稿合并后，一组一行（mcp.so 与官方 Registry 收录的同一个服务只有一行）。
 * draft 是合并后的草稿，结构与 ingest_drafts.draft 相同；source_id / external_id 是主条目的，
 * 翻译、AI 介绍、README 译文都按它们关联。网站和各生成任务读这张表；每次 publish 整体重建。
 * 以后的正式目录表（entities 等）从这里写入。
 */
export const ingestPublished = mysqlTable(
  'ingest_published',
  {
    id: pk(),
    kind: kindCol(),
    /** 网站上的地址（/servers/<slug>），同类型内唯一；重建时沿用上一次的 */
    slug: varchar('slug', { length: 191 }).notNull(),
    identityKey: varchar('identity_key', { length: 255 }).notNull(),
    /** 主条目的源记录（抓取时间取它的） */
    recordId: ref('record_id').notNull().references(() => ingestRecords.id, cascade),
    sourceId: sourceRef(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    /** 合并进来的来源，逗号分隔，如 mcp-registry,mcpso */
    sources: varchar('sources', { length: 255 }).notNull(),
    memberCount: smallint('member_count', { unsigned: true }).notNull(),
    draftHash: sha256('draft_hash').notNull(),
    draft: json('draft').notNull(),
    /** 页面内容的哈希：合并后的草稿去掉星数、源站更新时间等易变字段，加上 GitHub README 的哈希（见 merge/publish.ts contentHash） */
    contentHash: sha256('content_hash'),
    /** 页面内容最后一次变化的时间（sitemap 的 lastmod）；内容哈希没变时沿用上一次的，不知道时为空 */
    contentChangedAt: at('content_changed_at'),
    /** 成员草稿里最新的映射时间 */
    mappedAt: at('mapped_at').notNull(),
    publishedAt: at('published_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_ingest_published_slug').on(t.kind, t.slug),
    uniqueIndex('uq_ingest_published_identity').on(t.kind, t.identityKey),
    uniqueIndex('uq_ingest_published_primary').on(t.sourceId, t.kind, t.externalId),
  ],
)

/** 地址 → 发布条目：除了自己的 slug，还有被合并进来的成员原来的地址（mcp.so 的重复条目），旧链接也能打开 */
export const ingestPublishedSlugs = mysqlTable(
  'ingest_published_slugs',
  {
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    publishedId: ref('published_id').notNull().references(() => ingestPublished.id, cascade),
  },
  (t) => [primaryKey({ columns: [t.kind, t.slug] }), index('ix_ingest_published_slugs_published').on(t.publishedId)],
)

/**
 * 搜索与热门列表用的窄表：一行 = 一个发布条目在一种语言下的搜索文本和排序键，由 search-index 生成
 * （publish / github / translate / describe 结束时自动同步）。
 * 主键按 类型 → 语言 → 热度 → 精选 → slug 排列，与列表 sort=popular 的顺序一致：热门列表和关键词搜索都按主键顺序扫描，
 * 凑够一页就停，不用对整个类型现算排序键和译文指纹。发布层每次 publish 整体重建、id 会变，这里按 slug 关联。
 */
export const ingestSearch = mysqlTable(
  'ingest_search',
  {
    kind: kindCol(),
    locale: localeCol(),
    /** 越小越靠前：-热度；没有热度指标时取最大值，排在最后 */
    popRank: bigint('pop_rank', { mode: 'number' }).notNull(),
    /** 精选为 0、其余为 1：热度相同时精选在前 */
    featuredRank: tinyint('featured_rank').notNull(),
    slug: varchar('slug', { length: 191 }).notNull(),
    /** 能搜到的文字：名称、slug、英文简介、这种语言的简介译文、自撰简介，换行分隔 */
    body: mediumtext('body').notNull(),
    /** 排序键和 body 的指纹：同步时只改有变化的行 */
    rowHash: sha256('row_hash').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.locale, t.popRank, t.featuredRank, t.slug] }), uniqueIndex('uq_ingest_search_slug').on(t.kind, t.locale, t.slug)],
)

/**
 * 分类器的结果：一行 = 一个发布条目（按主条目的来源、类型、ID 关联）。
 * publish 时，来源没有给出分类的条目用这里的结果；输入、分类体系、提示词都没变就不重复分类。
 */
export const ingestClassifications = mysqlTable(
  'ingest_classifications',
  {
    id: pk(),
    sourceId: sourceRef(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    /** 主分类 slug；没有合适分类时为 other */
    primarySlug: varchar('primary_slug', { length: 64 }).notNull(),
    /** 次分类 slug，最多 2 个 */
    secondary: json('secondary').$type<string[]>().notNull(),
    /** 模型给出的把握程度 0–100 */
    confidence: smallint('confidence', { unsigned: true }).notNull(),
    taxonomyVersion: smallint('taxonomy_version', { unsigned: true }).notNull(),
    promptVersion: smallint('prompt_version', { unsigned: true }).notNull(),
    /** 输入（名称、简介、标签、工具、README 摘要……）的指纹 */
    inputHash: sha256('input_hash').notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    /** ok / review（把握不足，待人工复核） */
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    classifiedAt: at('classified_at').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_ingest_classifications_entity').on(t.sourceId, t.kind, t.externalId), index('ix_ingest_classifications_primary').on(t.kind, t.primarySlug)],
)
