import type {
  AliasType,
  AuthorDraft,
  DetailByKind,
  EntityDraftOf,
  IdentityHints,
  IssueCode,
  LinkType,
  ListName,
  MediaType,
  MetricName,
  MetricPeriod,
  Platform,
  TextField,
  TextFormat,
} from './draft.ts'
import { identityKey } from './identity.ts'
import type { EntityKind, Locale } from './types.ts'

/** 这些类型的条目理应有源码仓库，缺失时记一条数据质量问题 */
const REPO_EXPECTED: readonly EntityKind[] = ['server', 'client', 'cli', 'skill']

const today = () => new Date().toISOString().slice(0, 10)

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function tagSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

type Blank = string | null | undefined

/**
 * 草稿构建器（建造者模式）：各数据源的映射器用它逐项添加数据，
 * 统一处理空值过滤、URL 校验、去重和数据质量问题记录，映射器只关心"字段对应关系"。
 */
export class DraftBuilder<K extends EntityKind> {
  private readonly draft: EntityDraftOf<K>
  private readonly seen = new Set<string>()

  constructor(
    base: { kind: K; sourceId: string; externalId: string; sourceUrl: string; slug: string; name: string },
    detail: DetailByKind[K],
  ) {
    this.draft = {
      ...base,
      identity: {},
      identityKey: null,
      flags: {},
      texts: [],
      links: [],
      authors: [],
      categories: [],
      tags: [],
      metrics: [],
      media: [],
      aliases: [],
      listItems: [],
      platforms: [],
      detail,
      issues: [],
    }
  }

  private once(key: string): boolean {
    if (this.seen.has(key)) return false
    this.seen.add(key)
    return true
  }

  identity(hints: IdentityHints): this {
    for (const [key, value] of Object.entries(hints)) {
      if (value !== undefined && value !== '') (this.draft.identity as Record<string, unknown>)[key] = value
    }
    return this
  }

  flags(flags: EntityDraftOf<K>['flags']): this {
    Object.assign(this.draft.flags, flags)
    return this
  }

  set(field: 'license' | 'sourceCreatedAt' | 'sourceUpdatedAt' | 'lastCommitAt', value: Blank): this {
    if (value?.trim()) this.draft[field] = value.trim()
    return this
  }

  text(field: TextField, locale: Locale, content: Blank, format: TextFormat = 'plain'): this {
    const value = content?.trim()
    if (value && this.once(`text:${field}:${locale}`)) this.draft.texts.push({ field, locale, content: value, format })
    return this
  }

  link(type: LinkType, url: Blank, label?: string): this {
    if (!url?.trim()) return this
    const normalized = httpUrl(url)
    if (!normalized) return this.issue('invalid_url', `${type}: ${url}`)
    if (this.once(`link:${type}:${normalized}`)) this.draft.links.push({ type, url: normalized, ...(label ? { label } : {}) })
    return this
  }

  author(author: Omit<AuthorDraft, 'login'> & { login: Blank }): this {
    const login = author.login?.trim()
    if (!login || !this.once(`author:${author.platform}:${login.toLowerCase()}:${author.role}`)) return this
    this.draft.authors.push({ ...author, login })
    return this
  }

  /** slug 为 undefined 表示映射表里没有这个取值，记一条问题；null 表示已知但没有对应分类 */
  category(slug: string | null | undefined, sourceValue: Blank, primary = true): this {
    const value = sourceValue?.trim()
    if (!value || !this.once(`category:${value}`)) return this
    this.draft.categories.push({ slug: slug ?? null, sourceValue: value, primary })
    if (slug === undefined) this.issue('unmapped_category', value)
    return this
  }

  tags(values: Iterable<string>): this {
    for (const value of values) {
      const slug = tagSlug(value)
      if (slug && this.once(`tag:${slug}`)) this.draft.tags.push(slug)
    }
    return this
  }

  metric(metric: MetricName, value: number | null | undefined, period: MetricPeriod = 'total', observedOn = today()): this {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      this.draft.metrics.push({ metric, period, value: Math.round(value), observedOn })
    }
    return this
  }

  media(type: MediaType, url: Blank, base?: string): this {
    if (!url?.trim()) return this
    let absolute: string | undefined
    try {
      absolute = httpUrl(new URL(url.trim(), base).toString())
    } catch {
      absolute = undefined
    }
    if (!absolute) return this.issue('invalid_url', `${type}: ${url}`)
    if (this.once(`media:${type}:${absolute}`)) this.draft.media.push({ type, url: absolute })
    return this
  }

  alias(type: AliasType, value: Blank): this {
    const v = value?.trim()
    if (v && this.once(`alias:${type}:${v}`)) this.draft.aliases.push({ type, value: v })
    return this
  }

  listItems(list: ListName, locale: Locale, items: Iterable<string>): this {
    let position = this.draft.listItems.filter((i) => i.list === list && i.locale === locale).length
    for (const item of items) {
      const text = item.trim()
      if (text) this.draft.listItems.push({ list, locale, position: position++, text })
    }
    return this
  }

  platforms(values: Iterable<Platform>): this {
    for (const p of values) if (this.once(`platform:${p}`)) this.draft.platforms.push(p)
    return this
  }

  detail(update: (detail: DetailByKind[K]) => void): this {
    update(this.draft.detail)
    return this
  }

  issue(code: IssueCode, detail?: string): this {
    if (this.once(`issue:${code}:${detail ?? ''}`)) this.draft.issues.push({ code, ...(detail ? { detail } : {}) })
    return this
  }

  build(): EntityDraftOf<K> {
    const { identity } = this.draft
    if (identity.repository) this.draft.repository = identity.repository
    this.draft.identityKey = identityKey(identity)
    if (!identity.repository && REPO_EXPECTED.includes(this.draft.kind)) this.issue('missing_repository')
    return this.draft
  }
}
