import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core'
import { at, kindCol, localeCol, originCol, pk, ref, sha256, sourceIdCol, timestamps } from './columns.ts'

/*
 * 目录层（catalog）：网站读取的正式数据，跨来源合并后的结果。
 * 结构采用"公共主表 + 各类型详情表 + 多值属性子表"：
 *   entities ─┬─ 1:1  server_details / client_details / cli_details / skill_details / loop_details / agent_details
 *             ├─ 1:N  entity_texts（多语言文本）、entity_links、entity_metrics（时间序列）……
 *             └─ N:M  categories、tags、authors、platforms
 * 任何需要按值查询的信息（标签、环境变量名、工具名、参数名、安装方式……）都拆成独立的行，不存 JSON 字符串。
 */

const cascade = { onDelete: 'cascade' } as const
const setNull = { onDelete: 'set null' } as const

/* ========== 共享维度 ========== */

export const categories = mysqlTable(
  'categories',
  {
    id: pk(),
    kind: kindCol(),
    slug: varchar('slug', { length: 64 }).notNull(),
    parentId: ref('parent_id').references((): AnyMySqlColumn => categories.id, setNull),
    nameZh: varchar('name_zh', { length: 128 }).notNull(),
    nameEn: varchar('name_en', { length: 128 }).notNull(),
    nameJa: varchar('name_ja', { length: 128 }).notNull(),
    sortOrder: int('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_categories_kind_slug').on(t.kind, t.slug)],
)

export const tags = mysqlTable('tags', {
  id: pk(),
  slug: varchar('slug', { length: 64 }).notNull().unique('uq_tags_slug'),
  name: varchar('name', { length: 128 }).notNull(),
  ...timestamps(),
})

/** 作者/组织/厂商：GitHub 账号、公司等 */
export const authors = mysqlTable(
  'authors',
  {
    id: pk(),
    platform: varchar('platform', { length: 16 }).notNull(),
    login: varchar('login', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    type: varchar('type', { length: 16 }).notNull().default('unknown'),
    url: varchar('url', { length: 1024 }),
    avatarUrl: varchar('avatar_url', { length: 1024 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_authors_platform_login').on(t.platform, t.login)],
)

/** 源码仓库：同一仓库可能对应多个实体（monorepo），星数等统计挂在仓库上 */
export const repositories = mysqlTable(
  'repositories',
  {
    id: pk(),
    host: varchar('host', { length: 64 }).notNull(),
    owner: varchar('owner', { length: 128 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    ownerAuthorId: ref('owner_author_id').references(() => authors.id, setNull),
    description: text('description'),
    homepage: varchar('homepage', { length: 1024 }),
    defaultBranch: varchar('default_branch', { length: 128 }),
    primaryLanguage: varchar('primary_language', { length: 64 }),
    licenseSpdx: varchar('license_spdx', { length: 64 }),
    stars: int('stars', { unsigned: true }),
    forks: int('forks', { unsigned: true }),
    watchers: int('watchers', { unsigned: true }),
    openIssues: int('open_issues', { unsigned: true }),
    isArchived: boolean('is_archived').notNull().default(false),
    isFork: boolean('is_fork').notNull().default(false),
    repoCreatedAt: at('repo_created_at'),
    pushedAt: at('pushed_at'),
    lastCommitAt: at('last_commit_at'),
    syncedAt: at('synced_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_repositories_host_owner_name').on(t.host, t.owner, t.name), index('ix_repositories_stars').on(t.stars)],
)

export const repositoryTopics = mysqlTable(
  'repository_topics',
  {
    repositoryId: ref('repository_id').notNull().references(() => repositories.id, cascade),
    topic: varchar('topic', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.topic] }), index('ix_repository_topics_topic').on(t.topic)],
)

/* ========== 实体主表与通用子表 ========== */

export const entities = mysqlTable(
  'entities',
  {
    id: pk(),
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    /** 跨来源合并键，如 repo:github.com/microsoft/playwright-mcp、skill:anthropics/skills#pdf */
    identityKey: varchar('identity_key', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    iconUrl: varchar('icon_url', { length: 1024 }),
    /** draft 待审 / published 已发布 / hidden 隐藏 / archived 已归档 / removed 源站已下架 */
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    isOfficial: boolean('is_official').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(false),
    isFeatured: boolean('is_featured').notNull().default(false),
    primaryCategoryId: ref('primary_category_id').references(() => categories.id, setNull),
    repositoryId: ref('repository_id').references(() => repositories.id, setNull),
    /** monorepo 子目录，仓库根目录为空字符串 */
    repositoryPath: varchar('repository_path', { length: 512 }).notNull().default(''),
    licenseSpdx: varchar('license_spdx', { length: 64 }),
    /** 以下为排序用的冗余列，取自 entity_metrics 的最新值 */
    stars: int('stars', { unsigned: true }),
    installs: int('installs', { unsigned: true }),
    qualityScore: smallint('quality_score'),
    firstSeenAt: at('first_seen_at'),
    sourceUpdatedAt: at('source_updated_at'),
    lastCommitAt: at('last_commit_at'),
    publishedAt: at('published_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_entities_kind_slug').on(t.kind, t.slug),
    uniqueIndex('uq_entities_identity_key').on(t.identityKey),
    index('ix_entities_kind_status_stars').on(t.kind, t.status, t.stars),
    index('ix_entities_primary_category').on(t.primaryCategoryId),
    index('ix_entities_repository').on(t.repositoryId),
  ],
)

const entityRef = () => ref('entity_id').notNull().references(() => entities.id, cascade)

/** 多语言文本：一行 = 一个实体的一个字段的一种语言 */
export const entityTexts = mysqlTable(
  'entity_texts',
  {
    id: pk(),
    entityId: entityRef(),
    /** tagline / description / overview / readme / goal / exit_condition / kickoff_prompt */
    field: varchar('field', { length: 24 }).notNull(),
    locale: localeCol(),
    content: mediumtext('content').notNull(),
    format: varchar('format', { length: 16 }).notNull().default('plain'),
    origin: originCol(),
    sourceId: sourceIdCol(),
    /** origin = generated / translated 时记录使用的模型 */
    model: varchar('model', { length: 64 }),
    contentHash: sha256('content_hash').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_texts_field_locale').on(t.entityId, t.field, t.locale)],
)

/** 实体在各个来源中的对应条目（溯源） */
export const entitySources = mysqlTable(
  'entity_sources',
  {
    id: pk(),
    entityId: entityRef(),
    sourceId: sourceIdCol().notNull(),
    kind: kindCol(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    url: varchar('url', { length: 1024 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    firstSeenAt: at('first_seen_at'),
    lastSeenAt: at('last_seen_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_sources_external').on(t.sourceId, t.kind, t.externalId), index('ix_entity_sources_entity').on(t.entityId)],
)

export const entityLinks = mysqlTable(
  'entity_links',
  {
    id: pk(),
    entityId: entityRef(),
    /** repository / website / docs / source / npm / pypi / docker / remote / download / other */
    type: varchar('type', { length: 24 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: sha256('url_hash').notNull(),
    label: varchar('label', { length: 255 }),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_links_url').on(t.entityId, t.type, t.urlHash), index('ix_entity_links_type').on(t.type)],
)

/** 别名：旧 slug（用于 301 跳转）、命令别名、规范键等，也用于站内搜索 */
export const entityAliases = mysqlTable(
  'entity_aliases',
  {
    id: pk(),
    entityId: entityRef(),
    type: varchar('type', { length: 24 }).notNull(),
    value: varchar('value', { length: 255 }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_aliases').on(t.entityId, t.type, t.value), index('ix_entity_aliases_value').on(t.type, t.value)],
)

export const entityCategories = mysqlTable(
  'entity_categories',
  {
    entityId: entityRef(),
    categoryId: ref('category_id').notNull().references(() => categories.id, cascade),
    isPrimary: boolean('is_primary').notNull().default(false),
    origin: originCol(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.categoryId] }), index('ix_entity_categories_category').on(t.categoryId)],
)

export const entityTags = mysqlTable(
  'entity_tags',
  {
    entityId: entityRef(),
    tagId: ref('tag_id').notNull().references(() => tags.id, cascade),
    origin: originCol(),
    sourceId: sourceIdCol(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.tagId] }), index('ix_entity_tags_tag').on(t.tagId)],
)

export const entityAuthors = mysqlTable(
  'entity_authors',
  {
    entityId: entityRef(),
    authorId: ref('author_id').notNull().references(() => authors.id, cascade),
    /** owner / maintainer / vendor / publisher */
    role: varchar('role', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.authorId, t.role] }), index('ix_entity_authors_author').on(t.authorId)],
)

/** 支持的平台：macos / windows / linux / web / ios / android / vscode / jetbrains / cli */
export const entityPlatforms = mysqlTable(
  'entity_platforms',
  {
    entityId: entityRef(),
    platform: varchar('platform', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.platform] }), index('ix_entity_platforms_platform').on(t.platform)],
)

/** 指标时间序列：每个来源每天一行，可以画趋势、算周增长 */
export const entityMetrics = mysqlTable(
  'entity_metrics',
  {
    id: pk(),
    entityId: entityRef(),
    /** github_stars / github_forks / npm_downloads / pypi_downloads / skill_installs / source_views */
    metric: varchar('metric', { length: 32 }).notNull(),
    /** total 累计值 / day / week / month 区间值 */
    period: varchar('period', { length: 8 }).notNull().default('total'),
    sourceId: sourceIdCol().notNull(),
    observedOn: date('observed_on', { mode: 'string' }).notNull(),
    value: bigint('value', { mode: 'number', unsigned: true }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_entity_metrics_point').on(t.entityId, t.metric, t.sourceId, t.period, t.observedOn),
    index('ix_entity_metrics_metric_day').on(t.metric, t.observedOn),
  ],
)

export const entityMedia = mysqlTable(
  'entity_media',
  {
    id: pk(),
    entityId: entityRef(),
    /** icon / logo / cover / screenshot */
    type: varchar('type', { length: 16 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: sha256('url_hash').notNull(),
    width: smallint('width', { unsigned: true }),
    height: smallint('height', { unsigned: true }),
    position: smallint('position').notNull().default(0),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_media_url').on(t.entityId, t.type, t.urlHash)],
)

/** 多语言的有序短列表：CLI 能力、Skill 要点、使用场景等 */
export const entityListItems = mysqlTable(
  'entity_list_items',
  {
    id: pk(),
    entityId: entityRef(),
    /** capability / summary / use_case */
    list: varchar('list', { length: 24 }).notNull(),
    locale: localeCol(),
    position: smallint('position').notNull(),
    text: varchar('text', { length: 1024 }).notNull(),
    origin: originCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_list_items_pos').on(t.entityId, t.list, t.locale, t.position)],
)

/** 实体之间的关系：同类推荐、替代品、同仓库、可配合使用等 */
export const entityRelations = mysqlTable(
  'entity_relations',
  {
    entityId: entityRef(),
    relatedEntityId: ref('related_entity_id').notNull().references(() => entities.id, cascade),
    /** similar / alternative / same_repository / same_author / works_with */
    relation: varchar('relation', { length: 24 }).notNull(),
    score: decimal('score', { precision: 6, scale: 4 }),
    origin: originCol(),
    sourceId: sourceIdCol(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.relatedEntityId, t.relation] }), index('ix_entity_relations_related').on(t.relatedEntityId)],
)

/* ========== MCP 服务 ========== */

const detailKey = () => ref('entity_id').primaryKey().references(() => entities.id, cascade)

export const serverDetails = mysqlTable(
  'server_details',
  {
    entityId: detailKey(),
    isRemote: boolean('is_remote').notNull().default(false),
    /** node / python / go / rust / java / dotnet / docker / binary / other */
    runtime: varchar('runtime', { length: 16 }),
    /** none / api_key / oauth / other */
    authType: varchar('auth_type', { length: 16 }),
    version: varchar('version', { length: 64 }),
    /** 官方 MCP Registry 中的名称，如 io.github.microsoft/playwright-mcp */
    registryName: varchar('registry_name', { length: 255 }).unique('uq_server_details_registry_name'),
    protocolVersion: varchar('protocol_version', { length: 16 }),
    toolsCount: smallint('tools_count', { unsigned: true }).notNull().default(0),
    promptsCount: smallint('prompts_count', { unsigned: true }).notNull().default(0),
    resourcesCount: smallint('resources_count', { unsigned: true }).notNull().default(0),
    /** 最近一次实时探测（initialize + tools/list）的结果 */
    probedAt: at('probed_at'),
    probeStatus: varchar('probe_status', { length: 16 }),
    probeError: varchar('probe_error', { length: 512 }),
    ...timestamps(),
  },
  (t) => [index('ix_server_details_remote').on(t.isRemote)],
)

export const serverTransports = mysqlTable(
  'server_transports',
  {
    entityId: entityRef(),
    /** stdio / streamable-http / sse */
    transport: varchar('transport', { length: 24 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.transport] }), index('ix_server_transports_transport').on(t.transport)],
)

/** 安装包：npm / PyPI / Docker 镜像等，一个服务可以有多种 */
export const serverPackages = mysqlTable(
  'server_packages',
  {
    id: pk(),
    entityId: entityRef(),
    /** npm / pypi / oci / nuget / mcpb / cargo / go / other */
    registryType: varchar('registry_type', { length: 16 }).notNull(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    version: varchar('version', { length: 64 }),
    /** npx / uvx / docker / dnx */
    runtimeHint: varchar('runtime_hint', { length: 32 }),
    transport: varchar('transport', { length: 24 }),
    registryBaseUrl: varchar('registry_base_url', { length: 255 }),
    fileSha256: sha256('file_sha256'),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_server_packages').on(t.entityId, t.registryType, t.identifier),
    index('ix_server_packages_identifier').on(t.registryType, t.identifier),
  ],
)

export const serverPackageArguments = mysqlTable(
  'server_package_arguments',
  {
    id: pk(),
    packageId: ref('package_id').notNull().references(() => serverPackages.id, cascade),
    /** runtime（传给 npx/docker 的参数）/ package（传给服务本身的参数） */
    scope: varchar('scope', { length: 8 }).notNull(),
    /** positional / named */
    argType: varchar('arg_type', { length: 12 }).notNull(),
    name: varchar('name', { length: 128 }),
    value: varchar('value', { length: 1024 }),
    valueHint: varchar('value_hint', { length: 128 }),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    isRepeated: boolean('is_repeated').notNull().default(false),
    position: smallint('position').notNull().default(0),
  },
  (t) => [index('ix_server_package_arguments_package').on(t.packageId)],
)

/** 环境变量：只存名字和说明，从不存取值。可以查询"哪些服务需要 OPENAI_API_KEY" */
export const serverEnvVars = mysqlTable(
  'server_env_vars',
  {
    id: pk(),
    entityId: entityRef(),
    packageId: ref('package_id').references(() => serverPackages.id, setNull),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    isSecret: boolean('is_secret').notNull().default(false),
    defaultValue: varchar('default_value', { length: 1024 }),
    format: varchar('format', { length: 32 }),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_server_env_vars').on(t.entityId, t.name), index('ix_server_env_vars_name').on(t.name)],
)

/** 远程端点 */
export const serverRemotes = mysqlTable(
  'server_remotes',
  {
    id: pk(),
    entityId: entityRef(),
    transport: varchar('transport', { length: 24 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: sha256('url_hash').notNull(),
    /** none / oauth / bearer / header / unknown */
    authType: varchar('auth_type', { length: 16 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_server_remotes_url').on(t.entityId, t.urlHash)],
)

export const serverRemoteHeaders = mysqlTable(
  'server_remote_headers',
  {
    id: pk(),
    remoteId: ref('remote_id').notNull().references(() => serverRemotes.id, cascade),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    isSecret: boolean('is_secret').notNull().default(false),
    valueHint: varchar('value_hint', { length: 255 }),
  },
  (t) => [uniqueIndex('uq_server_remote_headers').on(t.remoteId, t.name)],
)

/** 工具：MCP tools/list 的每一项。行为提示（只读、破坏性……）拆成独立列，方便筛选 */
export const serverTools = mysqlTable(
  'server_tools',
  {
    id: pk(),
    entityId: entityRef(),
    name: varchar('name', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }),
    description: text('description'),
    inputSchema: json('input_schema'),
    outputSchema: json('output_schema'),
    annotations: json('annotations'),
    hintReadOnly: boolean('hint_read_only'),
    hintDestructive: boolean('hint_destructive'),
    hintIdempotent: boolean('hint_idempotent'),
    hintOpenWorld: boolean('hint_open_world'),
    position: smallint('position').notNull().default(0),
    origin: originCol(),
    sourceId: sourceIdCol(),
    fetchedAt: at('fetched_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_server_tools_name').on(t.entityId, t.name), index('ix_server_tools_name').on(t.name)],
)

/** 工具参数：从 inputSchema 展开，嵌套参数用点号路径 */
export const serverToolParams = mysqlTable(
  'server_tool_params',
  {
    id: pk(),
    toolId: ref('tool_id').notNull().references(() => serverTools.id, cascade),
    path: varchar('path', { length: 255 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    depth: tinyint('depth', { unsigned: true }).notNull().default(0),
    jsonType: varchar('json_type', { length: 64 }),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    enumValues: json('enum_values'),
    defaultValue: json('default_value'),
    position: smallint('position').notNull().default(0),
  },
  (t) => [uniqueIndex('uq_server_tool_params_path').on(t.toolId, t.path), index('ix_server_tool_params_name').on(t.name)],
)

export const serverPrompts = mysqlTable(
  'server_prompts',
  {
    id: pk(),
    entityId: entityRef(),
    name: varchar('name', { length: 128 }).notNull(),
    title: varchar('title', { length: 255 }),
    description: text('description'),
    position: smallint('position').notNull().default(0),
    origin: originCol(),
    fetchedAt: at('fetched_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_server_prompts_name').on(t.entityId, t.name)],
)

export const serverPromptArguments = mysqlTable(
  'server_prompt_arguments',
  {
    id: pk(),
    promptId: ref('prompt_id').notNull().references(() => serverPrompts.id, cascade),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    position: smallint('position').notNull().default(0),
  },
  (t) => [uniqueIndex('uq_server_prompt_arguments').on(t.promptId, t.name)],
)

export const serverResources = mysqlTable(
  'server_resources',
  {
    id: pk(),
    entityId: entityRef(),
    uri: varchar('uri', { length: 2048 }).notNull(),
    uriHash: sha256('uri_hash').notNull(),
    name: varchar('name', { length: 255 }),
    title: varchar('title', { length: 255 }),
    description: text('description'),
    mimeType: varchar('mime_type', { length: 128 }),
    /** 资源模板（URI 含变量） */
    isTemplate: boolean('is_template').notNull().default(false),
    position: smallint('position').notNull().default(0),
    origin: originCol(),
    fetchedAt: at('fetched_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_server_resources_uri').on(t.entityId, t.uriHash)],
)

/* ========== 客户端 ========== */

export const clientDetails = mysqlTable('client_details', {
  entityId: detailKey(),
  /** 源站原始类型，如 coding-agent */
  clientType: varchar('client_type', { length: 32 }),
  runtime: varchar('runtime', { length: 16 }),
  isOpenSource: boolean('is_open_source'),
  /** free / freemium / paid / unknown */
  pricing: varchar('pricing', { length: 16 }),
  ...timestamps(),
})

/** 客户端对 MCP 各项能力的支持情况：tools / resources / prompts / sampling / roots / elicitation / oauth …… */
export const clientCapabilities = mysqlTable(
  'client_capabilities',
  {
    entityId: entityRef(),
    capability: varchar('capability', { length: 32 }).notNull(),
    /** full / partial / none / unknown */
    support: varchar('support', { length: 12 }).notNull(),
    note: varchar('note', { length: 255 }),
    origin: originCol(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.capability] }), index('ix_client_capabilities').on(t.capability, t.support)],
)

/* ========== CLI ========== */

export const cliDetails = mysqlTable(
  'cli_details',
  {
    entityId: detailKey(),
    command: varchar('command', { length: 64 }),
    cliType: varchar('cli_type', { length: 32 }),
    isAgentReady: boolean('is_agent_ready'),
    lastVerifiedOn: date('last_verified_on', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [index('ix_cli_details_command').on(t.command)],
)

export const cliInstallMethods = mysqlTable(
  'cli_install_methods',
  {
    id: pk(),
    entityId: entityRef(),
    /** brew / npm / pip / pipx / uv / cargo / go / curl / winget / scoop / apt / docker / binary …… */
    manager: varchar('manager', { length: 16 }).notNull(),
    /** macos / linux / windows / any */
    platform: varchar('platform', { length: 16 }).notNull().default('any'),
    command: varchar('command', { length: 1024 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    position: smallint('position').notNull().default(0),
    origin: originCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_cli_install_methods').on(t.entityId, t.manager, t.platform), index('ix_cli_install_methods_manager').on(t.manager)],
)

export const cliExamples = mysqlTable(
  'cli_examples',
  {
    id: pk(),
    entityId: entityRef(),
    position: smallint('position').notNull(),
    command: varchar('command', { length: 1024 }).notNull(),
    origin: originCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_cli_examples_pos').on(t.entityId, t.position)],
)

/* ========== Skill ========== */

export const skillDetails = mysqlTable('skill_details', {
  entityId: detailKey(),
  /** owner/repo#skill */
  canonicalKey: varchar('canonical_key', { length: 255 }).unique('uq_skill_details_canonical_key'),
  skillSlug: varchar('skill_slug', { length: 128 }),
  skillPath: varchar('skill_path', { length: 512 }),
  installCommand: varchar('install_command', { length: 1024 }),
  firstSeenOn: date('first_seen_on', { mode: 'string' }),
  ...timestamps(),
})

export const skillSecurityAudits = mysqlTable(
  'skill_security_audits',
  {
    id: pk(),
    entityId: entityRef(),
    auditor: varchar('auditor', { length: 128 }).notNull(),
    /** pass / fail / warn / unknown */
    result: varchar('result', { length: 16 }).notNull(),
    auditedAt: at('audited_at'),
    url: varchar('url', { length: 1024 }),
    origin: originCol(),
    sourceId: sourceIdCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_skill_security_audits').on(t.entityId, t.auditor), index('ix_skill_security_audits_result').on(t.result)],
)

/* ========== Loop ========== */

export const loopDetails = mysqlTable('loop_details', {
  entityId: detailKey(),
  /** interval / until / event */
  loopType: varchar('loop_type', { length: 16 }),
  maxIterations: smallint('max_iterations', { unsigned: true }),
  intervalSeconds: int('interval_seconds', { unsigned: true }),
  checkCommand: varchar('check_command', { length: 1024 }),
  ...timestamps(),
})

/** 步骤按语言分别存储 */
export const loopSteps = mysqlTable(
  'loop_steps',
  {
    id: pk(),
    entityId: entityRef(),
    locale: localeCol(),
    position: smallint('position').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    origin: originCol(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_loop_steps_pos').on(t.entityId, t.locale, t.position)],
)

export const loopSupportedAgents = mysqlTable(
  'loop_supported_agents',
  {
    entityId: entityRef(),
    agentName: varchar('agent_name', { length: 128 }).notNull(),
    /** 能对应到目录里的客户端 / Agent 时填上 */
    agentEntityId: ref('agent_entity_id').references(() => entities.id, setNull),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.agentName] })],
)

/* ========== Agent ========== */

export const agentDetails = mysqlTable('agent_details', {
  entityId: detailKey(),
  /** product / framework / platform / other */
  agentType: varchar('agent_type', { length: 16 }),
  isOpenSource: boolean('is_open_source'),
  pricing: varchar('pricing', { length: 16 }),
  ...timestamps(),
})

/* ========== 转存到对象存储（Cloudflare R2）的图片：数据库只存链接，不存文件 ========== */

/** 一个原始图片地址一行；同样内容的图片共用一个存储文件（按内容哈希命名） */
export const mediaAssets = mysqlTable(
  'media_assets',
  {
    id: pk(),
    sourceUrl: varchar('source_url', { length: 2048 }).notNull(),
    sourceUrlHash: sha256('source_url_hash').notNull(),
    /** icon / screenshot / avatar */
    purpose: varchar('purpose', { length: 16 }).notNull(),
    /** pending 待处理 / ok 已转存 / failed 失败（会重试）/ skipped 不支持的格式 / gone 原图已不存在 */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    /** 对象存储里的路径，例如 icons/ab/ab12…ef.webp */
    storageKey: varchar('storage_key', { length: 255 }),
    publicUrl: varchar('public_url', { length: 512 }),
    /** 处理后文件的 SHA-256 */
    contentHash: sha256('content_hash'),
    mime: varchar('mime', { length: 64 }),
    width: smallint('width', { unsigned: true }),
    height: smallint('height', { unsigned: true }),
    bytes: int('bytes', { unsigned: true }),
    originalMime: varchar('original_mime', { length: 128 }),
    originalBytes: int('original_bytes', { unsigned: true }),
    httpStatus: smallint('http_status', { unsigned: true }),
    error: varchar('error', { length: 512 }),
    attempts: smallint('attempts', { unsigned: true }).notNull().default(0),
    lastAttemptAt: at('last_attempt_at'),
    nextRetryAt: at('next_retry_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_media_assets_source').on(t.sourceUrlHash),
    index('ix_media_assets_status').on(t.status, t.nextRetryAt),
    index('ix_media_assets_content').on(t.contentHash),
  ],
)
