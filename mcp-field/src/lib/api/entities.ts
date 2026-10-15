import type { Locale } from '../../i18n/locales'
import { apiGet } from './http'

/* 与后端 mcp-field-crawler/src/api/modules/entities 的返回结构保持一致 */

export type Kind = 'server' | 'client' | 'cli' | 'skill' | 'loop' | 'agent'

export const ROUTE: Record<Kind, string> = { server: 'servers', client: 'clients', cli: 'cli', skill: 'skills', loop: 'loops', agent: 'agents' }

export type ApiAuthor = { login: string; name: string | null; platform: string; url: string | null; avatarUrl: string | null; role: string }

/** 所有类型共有的列表字段 */
export type BaseItem = {
  kind: Kind
  slug: string
  name: string
  /** 已按请求语言本地化；没有译文时是原文 */
  tagline: string | null
  /** tagline 的实际语言；null 表示原文 */
  taglineLocale: Locale | null
  iconUrl: string | null
  category: { slug: string | null; source: string } | null
  author: ApiAuthor | null
  stars: number | null
  license: string | null
  tags: string[]
  official: boolean
  featured: boolean
  verified: boolean
  links: { repository: string | null; website: string | null; docs: string | null }
  lastCommitAt: string | null
  sourceUpdatedAt: string | null
}

export type ServerItem = BaseItem & { isRemote: boolean; runtime: string | null; transports: string[]; toolsCount: number }
export type ClientItem = BaseItem
export type CliItem = BaseItem & { command: string | null; installCommand: string | null; agentReady: boolean | null }
export type SkillItem = BaseItem & { installs: number | null; installCommand: string | null }
export type LoopItem = BaseItem & { loopType: string | null; maxIterations: number | null }
export type AgentItem = BaseItem & { agentType: string | null }

export type ApiOverview = {
  /** 实际返回的语言；请求的语言没有时退回英文 */
  locale: Locale
  summary: string
  features: string[]
  useCases: string[]
  mcp: string | null
  model: string | null
  generatedAt: string
}

/** README 的 AI 译文（只有中文、日文） */
export type ApiReadmeTranslation = {
  locale: 'zh' | 'ja'
  content: string
  /** 翻译后原文又有更新 */
  outdated: boolean
  status: string
  models: string[]
  license: string | null
  translatedAt: string
}

/** 所有类型共有的详情字段 */
export type DetailBase = {
  overview: ApiOverview | null
  readmeTranslation: ApiReadmeTranslation | null
  taglineOriginal: string | null
  identityKey: string | null
  /** 从 GitHub 抓取的 README；baseUrl 是 README 所在目录（https://github.com/o/r/blob/HEAD/dir/），用来解析相对链接 */
  readme: { format: string; content: string; baseUrl: string } | null
  authors: ApiAuthor[]
  screenshots: string[]
  previousSlugs: string[]
  metrics: { metric: string; period: string; value: number; observedOn: string }[]
  source: { id: string; url: string; fetchedAt: string; mappedAt: string; sourceCreatedAt: string | null }
  issues: { code: string; detail: string | null }[]
}

export type ToolParam = { path: string; type: string | null; description: string | null; required: boolean; enum: unknown[] | null; default: unknown }
export type ApiTool = { name: string; title: string | null; description: string | null; annotations: Record<string, unknown> | null; params: ToolParam[] }

export type ServerDetail = ServerItem &
  DetailBase & {
    /** 官方 MCP Registry 里登记的名称；没有登记时为 null */
    registryName: string | null
    version: string | null
    authType: string | null
    packages: { registryType: string; identifier: string; version: string | null; runtimeHint: string | null; transport: string | null }[]
    envVars: { name: string; description: string | null; required: boolean; secret: boolean }[]
    remotes: { transport: string; url: string; authType: string | null }[]
    tools: ApiTool[]
  }
export type ClientDetail = ClientItem & DetailBase & { clientType: string | null; runtime: string | null }
export type CliDetail = CliItem &
  DetailBase & {
    cliType: string | null
    lastVerifiedOn: string | null
    installs: { manager: string; platform: string; command: string }[]
    examples: string[]
    aliases: string[]
  }
/** 第三方安全审计：风险等级、摘要、行为类别、时间只有 skills.sh 收录的才有 */
export type SkillAudit = { auditor: string; result: string; riskLevel?: string; summary?: string; categories?: string[]; auditedAt?: string }
export type SkillDetail = SkillItem &
  DetailBase & {
    canonicalKey: string | null
    skillSlug: string | null
    firstSeenOn: string | null
    audits: SkillAudit[]
    /** SKILL.md 以外随 Skill 分发的文件路径 */
    files: string[]
  }
/** Loop 的执行说明（我们自己撰写，按语言返回；请求的语言没有时是英文） */
export type Playbook = {
  locale: Locale
  goal: string | null
  exitCondition: string | null
  steps: { position: number; title: string; body: string | null; command: string | null }[]
}
export type LoopDetail = LoopItem &
  DetailBase & { supportedAgents: { name: string; active: boolean }[]; checkCommand: string | null; playbook: Playbook | null }

export type AgentDetail = AgentItem & DetailBase

export type ItemOf = { server: ServerItem; client: ClientItem; cli: CliItem; skill: SkillItem; loop: LoopItem; agent: AgentItem }
export type DetailOf = { server: ServerDetail; client: ClientDetail; cli: CliDetail; skill: SkillDetail; loop: LoopDetail; agent: AgentDetail }

export type Facets = {
  total: number
  views: { official: number; featured: number; verified: number }
  /** 各子类型的数量（Agent：product / template） */
  types: { value: string; count: number }[]
  categories: { slug: string | null; count: number }[]
}

export type PageMeta = { page: number; pageSize: number; total: number; totalPages: number }

export type ListParams = {
  page?: number
  pageSize?: number
  q?: string
  /** 后端分类 slug；none = 没有对应分类 */
  category?: string
  featured?: boolean
  verified?: boolean
  official?: boolean
  /** 只对 MCP 服务有效 */
  remote?: boolean
  /** 子类型，只对 Agent 有效（product / template） */
  type?: string
  sort?: 'popular' | 'stars' | 'installs' | 'name' | 'updated' | 'newest'
  locale: Locale
  /** false = 后端不统计总数（meta.total 为 null），只要前几条时用，省一半查询 */
  withTotal?: boolean
}

export const fetchList = <K extends Kind>(kind: K, params: ListParams, signal?: AbortSignal) =>
  apiGet<{ data: ItemOf[K][]; meta: PageMeta }>(`/${ROUTE[kind]}`, params, signal)

export const fetchFacets = (kind: Kind, scope: { remote?: boolean } = {}, signal?: AbortSignal) =>
  apiGet<{ data: Facets }>(`/${ROUTE[kind]}/facets`, scope, signal).then((r) => r.data)

export const fetchDetail = <K extends Kind>(kind: K, slug: string, locale: Locale, signal?: AbortSignal) =>
  apiGet<{ data: DetailOf[K] }>(`/${ROUTE[kind]}/${encodeURIComponent(slug)}`, { locale }, signal).then((r) => r.data)
