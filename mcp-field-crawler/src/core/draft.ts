import type { EntityKind, Locale } from './types.ts'

/*
 * 实体草稿：映射阶段的产出。
 * 一个源站条目被拆成与目录表一一对应的细粒度部分（文本、链接、作者、分类、标签、指标……），
 * 发布阶段再把多个来源的草稿合并写入目录表。草稿只描述"这个来源说了什么"，不做跨源取舍。
 */

/** 数据从哪里来：源站原文 / 我们生成 / 翻译 / 人工 / 实时探测 */
export type Origin = 'source' | 'generated' | 'translated' | 'manual' | 'live'

export type TextField = 'tagline' | 'description' | 'overview' | 'readme' | 'goal' | 'exit_condition' | 'kickoff_prompt'
export type TextFormat = 'plain' | 'markdown' | 'html'

export type LinkType =
  | 'repository'
  | 'website'
  | 'docs'
  | 'source'
  | 'npm'
  | 'pypi'
  | 'docker'
  | 'remote'
  | 'download'
  | 'other'

export type AuthorPlatform = 'github' | 'gitlab' | 'npm' | 'website' | 'other'
export type AuthorRole = 'owner' | 'maintainer' | 'vendor' | 'publisher'

export type MetricName =
  | 'github_stars'
  | 'github_forks'
  | 'npm_downloads'
  | 'pypi_downloads'
  | 'skill_installs'
  | 'source_views'
export type MetricPeriod = 'total' | 'day' | 'week' | 'month'

export type MediaType = 'icon' | 'logo' | 'cover' | 'screenshot'
export type AliasType = 'previous_slug' | 'name' | 'command' | 'canonical_key'
export type ListName = 'capability' | 'summary' | 'use_case'

export type Transport = 'stdio' | 'streamable-http' | 'sse'
export type Platform = 'macos' | 'windows' | 'linux' | 'web' | 'ios' | 'android' | 'vscode' | 'jetbrains' | 'cli'

export interface TextDraft {
  field: TextField
  locale: Locale
  content: string
  format: TextFormat
}

export interface LinkDraft {
  type: LinkType
  url: string
  label?: string
}

export interface AuthorDraft {
  platform: AuthorPlatform
  login: string
  displayName?: string
  url?: string
  avatarUrl?: string
  role: AuthorRole
}

export interface CategoryDraft {
  /** 对应 mcp-field 的分类 slug；源站分类在 mcp-field 中没有对应项时为 null */
  slug: string | null
  /** 源站原始取值，便于回溯和调整映射 */
  sourceValue: string
  primary: boolean
}

export interface MetricDraft {
  metric: MetricName
  period: MetricPeriod
  value: number
  /** YYYY-MM-DD */
  observedOn: string
}

export interface MediaDraft {
  type: MediaType
  url: string
}

export interface AliasDraft {
  type: AliasType
  value: string
}

export interface ListItemDraft {
  list: ListName
  locale: Locale
  position: number
  text: string
}

export interface RepositoryRef {
  host: string
  owner: string
  name: string
  /** monorepo 子目录，如 src/filesystem；仓库根目录为空字符串 */
  path: string
}

/** 数据质量问题：写入 ingest_issues，便于集中排查 */
export type IssueCode =
  | 'unmapped_category'
  | 'missing_repository'
  | 'invalid_url'
  | 'invalid_json_field'
  | 'proxied_install_config'
  | 'suspicious_name'

export interface IssueDraft {
  code: IssueCode
  detail?: string
}

/** 跨来源合并实体时使用的身份线索 */
export interface IdentityHints {
  /** Skill 的唯一键 owner/repo#skill：同一仓库里通常有多个 Skill，不能只按仓库合并 */
  skillKey?: string
  repository?: RepositoryRef
  registryName?: string
  npmPackage?: string
  pypiPackage?: string
  remoteUrl?: string
  website?: string
}

/* ---------- 各类型专属部分 ---------- */

export interface ToolParamDraft {
  /** 点号路径，嵌套参数如 options.timeout */
  path: string
  jsonType?: string
  description?: string
  required: boolean
  enumValues?: unknown[]
  defaultValue?: unknown
}

export interface ToolDraft {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: Record<string, unknown>
  params: ToolParamDraft[]
}

export interface PackageDraft {
  registryType: 'npm' | 'pypi' | 'oci' | 'nuget' | 'mcpb' | 'cargo' | 'go' | 'other'
  identifier: string
  version?: string
  runtimeHint?: string
  transport?: Transport
}

export interface EnvVarDraft {
  name: string
  description?: string
  required: boolean
  secret: boolean
  defaultValue?: string
}

export interface RemoteDraft {
  transport: Transport
  url: string
  authType?: 'none' | 'oauth' | 'bearer' | 'header' | 'unknown'
}

export interface ServerDetailDraft {
  isRemote: boolean
  runtime?: string
  authType?: string
  version?: string
  transports: Transport[]
  packages: PackageDraft[]
  envVars: EnvVarDraft[]
  remotes: RemoteDraft[]
  tools: ToolDraft[]
}

export interface ClientDetailDraft {
  clientType?: string
  runtime?: string
}

export interface CliInstallDraft {
  manager: string
  platform: 'macos' | 'linux' | 'windows' | 'any'
  command: string
}

export interface CliDetailDraft {
  command?: string
  cliType?: string
  agentReady?: boolean
  lastVerifiedOn?: string
  installs: CliInstallDraft[]
  examples: string[]
}

export interface SkillAuditDraft {
  auditor: string
  result: 'pass' | 'fail' | 'warn' | 'unknown'
  /** 以下来自 skills.sh 的审计接口：风险等级（SAFE / LOW / MEDIUM / HIGH / CRITICAL）、结论摘要、涉及的行为类别、审计时间 */
  riskLevel?: string
  summary?: string
  categories?: string[]
  auditedAt?: string
}

export interface SkillDetailDraft {
  canonicalKey?: string
  skillSlug?: string
  installCommand?: string
  firstSeenOn?: string
  audits: SkillAuditDraft[]
  /** SKILL.md 以外随 Skill 分发的文件路径（references/、scripts/ ……） */
  files?: string[]
}

export interface LoopStepDraft {
  position: number
  title: string
  body?: string
}

export interface LoopDetailDraft {
  loopType?: string
  goal?: string
  checkCommand?: string
  exitCondition?: string
  maxIterations?: number
  kickoffPrompt?: string
  steps: LoopStepDraft[]
  supportedAgents: { name: string; active: boolean }[]
}

export interface AgentDetailDraft {
  agentType?: string
}

export interface DetailByKind {
  server: ServerDetailDraft
  client: ClientDetailDraft
  cli: CliDetailDraft
  skill: SkillDetailDraft
  loop: LoopDetailDraft
  agent: AgentDetailDraft
}

export interface EntityDraftOf<K extends EntityKind> {
  kind: K
  sourceId: string
  externalId: string
  sourceUrl: string
  identity: IdentityHints
  /** 由 identity 计算出的合并键，见 core/identity.ts */
  identityKey: string | null
  slug: string
  name: string
  flags: { official?: boolean; verified?: boolean; featured?: boolean }
  license?: string
  repository?: RepositoryRef
  sourceCreatedAt?: string
  sourceUpdatedAt?: string
  lastCommitAt?: string
  texts: TextDraft[]
  links: LinkDraft[]
  authors: AuthorDraft[]
  categories: CategoryDraft[]
  tags: string[]
  metrics: MetricDraft[]
  media: MediaDraft[]
  aliases: AliasDraft[]
  listItems: ListItemDraft[]
  platforms: Platform[]
  detail: DetailByKind[K]
  issues: IssueDraft[]
}

export type EntityDraft = { [K in EntityKind]: EntityDraftOf<K> }[EntityKind]
