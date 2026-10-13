import type { DiscoverOptions, Discoverer } from '../../core/source.ts'
import type { CrawlTarget } from '../../core/types.ts'
import type { SkillsShFetcher } from './fetcher.ts'
import { listingSchema, listPageSchema } from './schema.ts'
import { listUrl, skillUrl } from './urls.ts'

const WEEK_MS = 7 * 24 * 3600_000

/**
 * 列表没有更新时间，用"每周一个周期"代替：lastmod 取本周期的开始，本周期内抓过的目标直接跳过，
 * 所以每个 skill 每周最多重新请求一次（内容哈希没变的不会重新解析）。
 */
export const weekStart = (now = Date.now()) => new Date(Math.floor(now / WEEK_MS) * WEEK_MS)

/**
 * 翻全站排行榜（按累计安装量，每页 500 条，最多前 10 万条），每个 skill 产出一个目标（地址是它的详情接口），
 * 排行榜条目交给 SkillsShFetcher，抓取时并进文档。
 */
export class SkillsShDiscoverer implements Discoverer {
  constructor(
    private readonly fetcher: SkillsShFetcher,
    private readonly sourceId: string,
  ) {}

  async *discover({ kinds, limitPerKind, signal }: DiscoverOptions): AsyncIterable<CrawlTarget> {
    if (!kinds.includes('skill')) return
    const seen = new Set<string>()
    const lastmod = weekStart()
    for (let page = 0; ; page++) {
      if (signal?.aborted) return
      const doc = await this.fetcher.fetch({ url: listUrl(page), headers: { accept: 'application/json' } })
      const body = listPageSchema.parse(JSON.parse(doc.body))
      for (const raw of body.data) {
        const parsed = listingSchema.safeParse(raw)
        if (!parsed.success) continue
        const listing = parsed.data
        // 翻页期间排名会变，同一条可能出现两次
        // 名称里带 /、或 id 与 来源/名称 对不上的，详情接口不支持（返回 400 invalid_path）
        if (seen.has(listing.id) || listing.slug.includes('/') || listing.id !== `${listing.source}/${listing.slug}`) continue
        seen.add(listing.id)
        const url = skillUrl(listing.source, listing.slug)
        this.fetcher.remember(url, listing)
        yield { sourceId: this.sourceId, kind: 'skill', externalId: listing.id, url, lastmod }
        if (limitPerKind !== undefined && seen.size >= limitPerKind) return
      }
      if (!body.pagination?.hasMore || body.data.length === 0) return
    }
  }
}
