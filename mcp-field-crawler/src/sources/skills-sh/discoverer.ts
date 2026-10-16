import { parseRepositoryUrl } from '../../core/identity.ts'
import type { DiscoverOptions, Discoverer } from '../../core/source.ts'
import type { CrawlTarget } from '../../core/types.ts'
import { repoRef } from '../../github/repo.ts'
import type { SkillsShActivity } from './activity.ts'
import type { SkillsShFetcher } from './fetcher.ts'
import { listingSchema, listPageSchema, type SkillsShListing } from './schema.ts'
import { listUrl, skillUrl, type ListView } from './urls.ts'

const DAY_MS = 24 * 3600_000
/** 已收录的 Skill 至少隔这么久才重新抓详情 */
export const REFRESH_MIN_MS = 7 * DAY_MS
/** 仓库一直没有推送的，也隔这么久重新抓一次（安全审计会更新） */
export const REFRESH_MAX_MS = 90 * DAY_MS
const PER_PAGE = 500
/** 排行榜只能翻到前 10 万条 */
const LIST_WINDOW = 100_000
/** 排行榜同时请求的页数：每页实测 6–8 秒 */
const PAGE_CONCURRENCY = 4
/** 排行榜偶尔返回 HTML 错误页（2026-10 实测 187 页里 2 次），重新请求 */
const PAGE_ATTEMPTS = 3

/**
 * 排行榜没有更新时间，用 GitHub 仓库最近一次推送的时间代替 lastmod（github 命令每天更新）：
 * 上次抓取之后仓库有推送、且距上次抓取超过 7 天的重新抓；仓库没有推送的 90 天重新抓一次；
 * 查不到推送时间的（well-known 来源、仓库不存在或还没统计）每 7 天重新抓一次。新出现的 Skill 总是抓。
 * 运行器在 lastmod 晚于上次抓取时间时才抓，所以 lastmod = min(max(推送时间, 现在 - 90 天), 现在 - 7 天)。
 */
export function refreshLastmod(pushedAt: Date | undefined, now = Date.now()): Date {
  if (!pushedAt) return new Date(now - REFRESH_MIN_MS)
  return new Date(Math.min(Math.max(pushedAt.getTime(), now - REFRESH_MAX_MS), now - REFRESH_MIN_MS))
}

const repoKey = (listing: SkillsShListing) =>
  listing.sourceType !== 'well-known' && listing.source.includes('/') ? repoRef({ identity: { repository: parseRepositoryUrl(`https://github.com/${listing.source}`) } })?.key : undefined

/**
 * 翻全站排行榜（按累计安装量，每页 500 条，最多前 10 万条），再翻 trending 补上还没进全站榜的新 Skill；
 * 每个 skill 产出一个目标（地址是它的详情接口），排行榜条目交给 SkillsShFetcher，抓取时并进文档。
 * 全站榜的安装量交给 activity 记下，发布时更新到 Skill 上（已收录的不必为了安装量重新抓详情）。
 */
export class SkillsShDiscoverer implements Discoverer {
  constructor(
    private readonly fetcher: SkillsShFetcher,
    private readonly sourceId: string,
    private readonly activity?: SkillsShActivity,
  ) {}

  async *discover({ kinds, limitPerKind, signal }: DiscoverOptions): AsyncIterable<CrawlTarget> {
    if (!kinds.includes('skill')) return
    const pushed = (await this.activity?.repoPushedAt()) ?? new Map<string, Date>()
    const installs = new Map<string, number>()
    const seen = new Set<string>()
    const now = Date.now()
    try {
      for (const view of ['all-time', 'trending'] as const) {
        for await (const raw of this.listings(view, signal)) {
          const parsed = listingSchema.safeParse(raw)
          if (!parsed.success) continue
          const listing = parsed.data
          // 翻页期间排名会变，同一条可能出现两次
          // 名称里带 /、或 id 与 来源/名称 对不上的，详情接口不支持（返回 400 invalid_path）
          if (seen.has(listing.id) || listing.slug.includes('/') || listing.id !== `${listing.source}/${listing.slug}`) continue
          seen.add(listing.id)
          // trending 的安装量是近期的，只记全站榜的
          if (view === 'all-time' && typeof listing.installs === 'number') installs.set(listing.id, listing.installs)
          const url = skillUrl(listing.source, listing.slug)
          this.fetcher.remember(url, listing)
          const pushedAt = pushed.get(repoKey(listing) ?? '')
          yield { sourceId: this.sourceId, kind: 'skill', externalId: listing.id, url, lastmod: refreshLastmod(pushedAt, now) }
          if (limitPerKind !== undefined && seen.size >= limitPerKind) return
        }
      }
    } finally {
      // 中断或抽样时也保存已经翻到的
      if (installs.size > 0) await this.activity?.saveInstalls(installs)
    }
  }

  /** 按顺序产出排行榜条目：先请求第一页拿到总数，之后每次并发请求几页（不超过 10 万条的上限） */
  private async *listings(view: ListView, signal?: AbortSignal): AsyncIterable<unknown> {
    const first = await this.page(view, 0)
    yield* first.data
    const total = Math.min(first.pagination?.total ?? LIST_WINDOW, LIST_WINDOW)
    let more = !!first.pagination?.hasMore && first.data.length > 0
    for (let start = 1; more && start * PER_PAGE < total; start += PAGE_CONCURRENCY) {
      if (signal?.aborted) return
      const count = Math.min(PAGE_CONCURRENCY, Math.ceil(total / PER_PAGE) - start)
      const pages = await Promise.all(Array.from({ length: count }, (_, i) => this.page(view, start + i)))
      for (const body of pages) {
        yield* body.data
        more = !!body.pagination?.hasMore && body.data.length > 0
        if (!more) return
      }
    }
  }

  private async page(view: ListView, page: number) {
    for (let attempt = 1; ; attempt++) {
      const doc = await this.fetcher.fetch({ url: listUrl(page, view, PER_PAGE), headers: { accept: 'application/json' } })
      try {
        return listPageSchema.parse(JSON.parse(doc.body))
      } catch (error) {
        if (attempt >= PAGE_ATTEMPTS) throw error
      }
    }
  }
}
