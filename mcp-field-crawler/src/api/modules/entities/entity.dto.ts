import type { EntityKind } from '../../../core/types.ts'

/** 各类型接口对外返回的数据结构（与内部草稿/表结构解耦） */

export interface CategoryRef {
  /** mcp-field 分类 slug；null = 源站分类在 mcp-field 中没有对应项 */
  slug: string | null
  /** 源站原始分类 */
  source: string
}

export interface AuthorDto {
  login: string
  name: string | null
  platform: string
  url: string | null
  avatarUrl: string | null
  role: string
}

/** 所有类型共有的列表字段；各类型的专有字段由 presenter 平铺追加 */
export interface EntityListItem {
  kind: EntityKind
  slug: string
  name: string
  /** 按请求的语言返回；没有译文时是原文（Skill 取 description） */
  tagline: string | null
  /** tagline 的实际语言；null 表示原文（未翻译） */
  taglineLocale: 'zh' | 'en' | 'ja' | null
  iconUrl: string | null
  category: CategoryRef | null
  author: AuthorDto | null
  /** GitHub 星数 */
  stars: number | null
  license: string | null
  tags: string[]
  official: boolean
  featured: boolean
  verified: boolean
  links: { repository: string | null; website: string | null; docs: string | null }
  lastCommitAt: string | null
  sourceUpdatedAt: string | null
  [extra: string]: unknown
}

/** AI 根据 README 生成的介绍 */
export interface OverviewDto {
  /** 实际返回的语言（请求的语言没有时退回英文） */
  locale: 'zh' | 'en' | 'ja'
  summary: string
  features: string[]
  useCases: string[]
  mcp: string | null
  model: string | null
  generatedAt: string
}

/** README 的 AI 译文（只有中文、日文） */
export interface ReadmeTranslationDto {
  locale: 'zh' | 'ja'
  content: string
  /** 翻译后原文又有更新 */
  outdated: boolean
  /** ok / review */
  status: string
  models: string[]
  /** 原项目许可证 */
  license: string | null
  translatedAt: string
}

/** Loop 的执行说明（我们自己撰写，按语言返回） */
export interface PlaybookDto {
  locale: 'zh' | 'en' | 'ja'
  goal: string | null
  exitCondition: string | null
  steps: { position: number; title: string; body: string | null; command: string | null }[]
}

export interface EntityDetail extends EntityListItem {
  overview: OverviewDto | null
  /** 只有 Loop 有 */
  playbook?: PlaybookDto | null
  readmeTranslation: ReadmeTranslationDto | null
  /** 源站原文，便于核对译文 */
  taglineOriginal: string | null
  identityKey: string | null
  /** 从 GitHub 抓取的 README；baseUrl 是 README 所在目录，用来解析相对链接 */
  readme: { format: string; content: string; baseUrl: string } | null
  authors: AuthorDto[]
  allLinks: { type: string; url: string; label: string | null }[]
  screenshots: string[]
  previousSlugs: string[]
  metrics: { metric: string; period: string; value: number; observedOn: string }[]
  /** 数据来源与采集时间，便于核对 */
  source: { id: string; url: string; fetchedAt: string; mappedAt: string; sourceCreatedAt: string | null }
  /** 映射时发现的数据质量问题 */
  issues: { code: string; detail: string | null }[]
}

export interface CategoryFacet {
  slug: string | null
  count: number
  /** 归入这个分类的源站原始分类及数量 */
  sources: { value: string; count: number }[]
}

/** 目录页侧栏需要的全部计数 */
export interface EntityFacets {
  total: number
  views: { official: number; featured: number; verified: number }
  /** 各子类型的数量（Agent：product / template）；没有子类型时为空 */
  types: { value: string; count: number }[]
  categories: CategoryFacet[]
}
