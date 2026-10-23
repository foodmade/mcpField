import type { AuthorDraft, EntityDraftOf, LinkType, TextField } from '../../../core/draft.ts'
import type { EntityKind, Locale } from '../../../core/types.ts'
import type { AssetReader } from '../../../assets/store.ts'
import type { GeneratedReader } from '../../../describe/store.ts'
import { readmeSubject, type GithubReadme } from '../../../github/readme.ts'
import { repoRef } from '../../../github/repo.ts'
import type { GithubReadmeReader, GithubRepoReader } from '../../../github/store.ts'
import type { OverviewReader } from '../../../overview/store.ts'
import { readmeHash } from '../../../readme/chunk.ts'
import { resolveReadme } from '../../../readme/source.ts'
import type { ReadmeTranslationReader } from '../../../readme/store.ts'
import { localizeTools } from '../../../tools/translate.ts'
import { sourceHash } from '../../../translate/key.ts'
import type { TranslationReader } from '../../../translate/memory.ts'
import { pageMeta, type ListQuery, type PageMeta, type Scope } from '../../http/query.ts'
import { TtlCache } from '../../http/ttl-cache.ts'
import { stableJson } from '../../../store/hash.ts'
import type { EntityReadRepository, EntityRow } from '../../repositories/types.ts'
import type { AuthorDto, CategoryFacet, EntityDetail, EntityFacets, EntityListItem } from './entity.dto.ts'
import type { EntityPresenter } from './presenters.ts'

type AnyDraft = EntityDraftOf<EntityKind>
type ListResult = { data: EntityListItem[]; meta: PageMeta & { locale: Locale } }

/** 列表、目录计数的结果缓存（首页一次并发十几个列表查询，服务器 2 核，不缓存时首页要 4–6 秒）；关键词搜索不缓存 */
export interface ResultCacheOptions {
  ttlMs: number
  /** 列表缓存的条数上限（不同的筛选、排序、页码、语言各算一条） */
  maxLists: number
}

const text = (d: AnyDraft, field: TextField, locale = 'en') => d.texts.find((t) => t.field === field && t.locale === locale)
/** 卡片上的一句话简介：优先 tagline，没有时用 description（Skill 只有 description） */
const taglineOf = (d: AnyDraft) => (text(d, 'tagline') ?? text(d, 'description'))?.content ?? null
const link = (d: AnyDraft, type: LinkType) => d.links.find((l) => l.type === type)?.url ?? null

function toAuthor(a: AuthorDraft): AuthorDto {
  return { login: a.login, name: a.displayName ?? null, platform: a.platform, url: a.url ?? null, avatarUrl: a.avatarUrl ?? null, role: a.role }
}

/** 可选的本地化数据源：没有提供时对应字段返回原文或 null */
export interface Localization {
  translations?: TranslationReader
  overviews?: OverviewReader
  readmes?: ReadmeTranslationReader
  /** 图片转存记录：有转存地址时替换原始图片地址 */
  assets?: AssetReader
  /** 我们自己撰写的内容（Loop / CLI / Agent 的简介、Loop 的目标与步骤） */
  generated?: GeneratedReader
  /** 从 GitHub 抓取的 README（不用源站收录的） */
  githubReadmes?: GithubReadmeReader
  /** GitHub 仓库统计：星数、最近提交时间优先用它，没抓到时用源站的 */
  githubRepos?: GithubRepoReader
}

/**
 * 通用的目录业务逻辑：分页、DTO 组装、分类汇总、简介本地化、AI 介绍、README 译文。
 * 六种类型共用一个实现，类型差异由 presenter 提供；只依赖仓储接口，不关心数据存在哪张表。
 */
export class EntityService<K extends EntityKind> {
  constructor(
    readonly kind: K,
    private readonly repository: EntityReadRepository<K>,
    private readonly presenter: EntityPresenter<K>,
    private readonly localization: Localization = {},
    cache?: ResultCacheOptions,
  ) {
    this.listCache = cache ? new TtlCache(cache.ttlMs, cache.maxLists) : null
    this.facetCache = cache ? new TtlCache(cache.ttlMs, 16) : null
  }

  private readonly listCache: TtlCache<ListResult> | null
  private readonly facetCache: TtlCache<{ data: EntityFacets }> | null

  list(query: ListQuery): Promise<ListResult> {
    if (!this.listCache || query.q) return this.loadList(query)
    return this.listCache.get(stableJson(query), () => this.loadList(query))
  }

  private async loadList(query: ListQuery): Promise<ListResult> {
    const { rows, total } = await this.repository.list(query)
    return { data: await this.toListItems(rows, query.locale), meta: { ...pageMeta(query, total), locale: query.locale } }
  }

  /** 按正式地址取列表项（收藏列表用），保持传入的顺序；不存在的跳过 */
  async listBySlugs(slugs: string[], locale: Locale): Promise<EntityListItem[]> {
    if (slugs.length === 0) return []
    return this.toListItems(await this.repository.listBySlugs(slugs), locale)
  }

  private async toListItems(rows: EntityRow<K>[], locale: Locale): Promise<EntityListItem[]> {
    const items = rows.map((row) => this.toListItem(row.draft))
    await Promise.all([this.localize(items, locale), this.mirrorIcons(items), this.applyRepoStats(items, rows.map((row) => row.draft))])
    await this.fillGenerated(items, locale)
    return items
  }

  async get(slug: string, locale: Locale = 'en'): Promise<EntityDetail | null> {
    const row = await this.repository.findBySlug(slug)
    if (!row) return null
    const detail = this.toDetail(row, await this.githubReadme(row.draft))
    await Promise.all([
      this.localize([detail], locale),
      this.mirrorIcons([detail], detail),
      this.applyRepoStats([detail], [row.draft]),
      Array.isArray(detail.tools) ? this.localizeTools(detail.tools, locale) : undefined,
    ])
    await this.fillGenerated([detail], locale)

    const ref = { sourceId: row.draft.sourceId, kind: this.kind, externalId: row.draft.externalId }
    const [translated, overview] = await Promise.all([
      detail.readme && locale !== 'en' ? this.localization.readmes?.find(ref, locale) : undefined,
      this.localization.overviews?.find(ref, locale),
    ])
    if (translated && detail.readme) {
      detail.readmeTranslation = {
        locale: locale as 'zh' | 'ja',
        content: translated.content,
        outdated: translated.readmeHash !== readmeHash(detail.readme.content.trim()),
        status: translated.status,
        models: translated.models?.split(',').filter(Boolean) ?? [],
        license: translated.license,
        translatedAt: translated.translatedAt.toISOString(),
      }
    }
    if (this.kind === 'loop') {
      const playbook = await this.localization.generated?.playbook(ref, locale)
      detail.playbook = playbook ?? null
    }
    if (overview) {
      detail.overview = {
        locale: overview.locale,
        summary: overview.summary,
        features: overview.features,
        useCases: overview.useCases,
        mcp: overview.mcp || null,
        model: overview.model,
        generatedAt: overview.generatedAt.toISOString(),
      }
    }
    return detail
  }

  async categories(scope?: Scope): Promise<{ data: CategoryFacet[]; meta: { total: number } }> {
    const counts = await this.repository.categoryCounts(scope)
    const facets = new Map<string | null, CategoryFacet>()
    for (const c of counts) {
      const facet = facets.get(c.slug) ?? { slug: c.slug, count: 0, sources: [] }
      facet.count += c.count
      facet.sources.push({ value: c.sourceValue, count: c.count })
      facets.set(c.slug, facet)
    }
    const data = [...facets.values()].sort((a, b) => b.count - a.count)
    return { data, meta: { total: data.reduce((sum, f) => sum + f.count, 0) } }
  }

  facets(scope?: Scope): Promise<{ data: EntityFacets }> {
    if (!this.facetCache) return this.loadFacets(scope)
    return this.facetCache.get(stableJson(scope ?? {}), () => this.loadFacets(scope))
  }

  private async loadFacets(scope?: Scope): Promise<{ data: EntityFacets }> {
    const [{ data: categories, meta }, views, types] = await Promise.all([this.categories(scope), this.repository.viewCounts(scope), this.repository.typeCounts(scope)])
    return { data: { total: meta.total, views, types, categories } }
  }

  /** sitemap：分页列出允许收录的 slug 和最后更新时间 */
  async sitemap(page: number, pageSize: number) {
    const { rows, total } = await this.repository.sitemap((page - 1) * pageSize, pageSize)
    return { data: rows, meta: pageMeta({ page, pageSize }, total) }
  }

  private async githubReadme(d: EntityDraftOf<K>): Promise<GithubReadme | undefined> {
    const subject = readmeSubject(d)
    const reader = this.localization.githubReadmes
    if (!subject || !reader) return undefined
    return (await reader.find([subject.key])).get(subject.key)
  }

  /** 星数、最近提交时间换成 GitHub 的数据；没抓到的保留源站的 */
  private async applyRepoStats(items: EntityListItem[], drafts: AnyDraft[]): Promise<void> {
    const reader = this.localization.githubRepos
    if (!reader) return
    const refs = drafts.map(repoRef)
    const found = await reader.find(refs.flatMap((r) => (r ? [r.key] : [])))
    items.forEach((item, i) => {
      const stats = found.get(refs[i]?.key ?? '')
      if (!stats) return
      item.stars = stats.stars
      item.lastCommitAt = stats.lastCommitAt ?? item.lastCommitAt
    })
  }

  /** 源站没有简介的条目（Loop / CLI / Agent）用我们自己撰写的简介 */
  private async fillGenerated(items: EntityListItem[], locale: Locale): Promise<void> {
    const reader = this.localization.generated
    const missing = items.filter((i) => !i.tagline)
    if (!reader || missing.length === 0) return
    const taglines = await reader.taglines(this.kind, missing.map((i) => i.slug), locale)
    for (const item of missing) {
      const t = taglines.get(item.slug)
      if (t) {
        item.tagline = t
        item.taglineLocale = locale
      }
    }
  }

  /** 图标（详情还有截图）换成转存到 R2 的地址；还没转存的保留原地址 */
  private async mirrorIcons(items: EntityListItem[], detail?: EntityDetail): Promise<void> {
    const reader = this.localization.assets
    if (!reader) return
    const urls = [...items.map((i) => i.iconUrl), ...(detail?.screenshots ?? [])].filter((u): u is string => !!u)
    if (urls.length === 0) return
    const mirrored = await reader.lookup(urls)
    for (const item of items) if (item.iconUrl) item.iconUrl = mirrored.get(item.iconUrl) ?? item.iconUrl
    if (detail) detail.screenshots = detail.screenshots.map((u) => mirrored.get(u) ?? u)
  }

  /** 把简介换成请求语言的译文（翻译记忆库按原文指纹查找）；找不到时保留原文 */
  private async localize(items: EntityListItem[], locale: Locale): Promise<void> {
    const reader = this.localization.translations
    if (!reader) return
    const withTagline = items.filter((i) => i.tagline)
    const hashes = withTagline.map((i) => sourceHash(i.tagline!))
    const found = await reader.lookup(hashes, locale)
    withTagline.forEach((item, idx) => {
      const translated = found.get(hashes[idx]!)
      if (translated) {
        item.tagline = translated
        item.taglineLocale = locale
      }
    })
  }

  /** MCP 服务的工具描述和参数说明换成请求语言的译文；实时读取的工具列表也用它（同样的原文能查到同样的译文） */
  async localizeTools(tools: Parameters<typeof localizeTools>[0], locale: Locale): Promise<void> {
    const reader = this.localization.translations
    if (reader) await localizeTools(tools, reader, locale)
  }

  private toListItem(d: EntityDraftOf<K>): EntityListItem {
    const primary = d.categories.find((c) => c.primary) ?? d.categories[0]
    const owner = d.authors.find((a) => a.role === 'owner') ?? d.authors[0]
    return {
      kind: d.kind,
      slug: d.slug,
      name: d.name,
      tagline: taglineOf(d),
      taglineLocale: null,
      iconUrl: d.media.find((m) => m.type === 'icon')?.url ?? null,
      category: primary ? { slug: primary.slug, source: primary.sourceValue } : null,
      author: owner ? toAuthor(owner) : null,
      stars: d.metrics.find((m) => m.metric === 'github_stars')?.value ?? null,
      license: d.license ?? null,
      tags: d.tags,
      official: d.flags.official ?? false,
      featured: d.flags.featured ?? false,
      verified: d.flags.verified ?? false,
      links: { repository: link(d, 'repository'), website: link(d, 'website'), docs: link(d, 'docs') },
      lastCommitAt: d.lastCommitAt ?? null,
      sourceUpdatedAt: d.sourceUpdatedAt ?? null,
      ...this.presenter.list(d),
    }
  }

  private toDetail({ draft: d, fetchedAt, mappedAt, indexable }: EntityRow<K>, github?: GithubReadme): EntityDetail {
    const readme = resolveReadme(github)
    return {
      ...this.toListItem(d),
      overview: null,
      readmeTranslation: null,
      taglineOriginal: taglineOf(d),
      identityKey: d.identityKey,
      readme: readme ? { format: readme.format, content: readme.content, baseUrl: readme.baseUrl } : null,
      authors: d.authors.map(toAuthor),
      screenshots: d.media.filter((m) => m.type === 'screenshot').map((m) => m.url),
      previousSlugs: d.aliases.filter((a) => a.type === 'previous_slug').map((a) => a.value),
      metrics: d.metrics,
      source: { id: d.sourceId, url: d.sourceUrl, fetchedAt, mappedAt, sourceCreatedAt: d.sourceCreatedAt ?? null },
      issues: d.issues.map((i) => ({ code: i.code, detail: i.detail ?? null })),
      indexable: indexable ?? true,
      ...this.presenter.detail(d),
    }
  }
}
