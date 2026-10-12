import type { DiscoverOptions, Discoverer } from '../../core/source.ts'
import type { CrawlTarget } from '../../core/types.ts'
import type { PrefetchFetcher } from '../../fetch/prefetch.ts'
import { listSchema, OFFICIAL_META } from './schema.ts'
import { listUrl, serverUrl } from './urls.ts'

interface ListEntry {
  server?: { name?: unknown }
  _meta?: Record<string, { updatedAt?: unknown } | undefined>
}

/**
 * 按游标翻列表接口，每个服务产出一个目标（地址是它的详情接口），lastmod 取 Registry 记录的更新时间。
 * 列表条目本身就是完整的 server.json，直接预取给抓取器：详情接口实测每次 40–60 秒，列表 100 条只要 2–6 秒。
 */
export class RegistryDiscoverer implements Discoverer {
  constructor(
    private readonly fetcher: PrefetchFetcher,
    private readonly sourceId: string,
  ) {}

  async *discover({ kinds, limitPerKind, since, signal }: DiscoverOptions): AsyncIterable<CrawlTarget> {
    if (!kinds.includes('server')) return
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      if (signal?.aborted) return
      const doc = await this.fetcher.fetch({ url: listUrl({ cursor, since }), headers: { accept: 'application/json' } })
      const page = listSchema.parse(JSON.parse(doc.body))

      for (const raw of page.servers as ListEntry[]) {
        const name = raw?.server?.name
        // 翻页期间有服务更新时，同一条可能出现在两页里
        if (typeof name !== 'string' || !name || seen.has(name)) continue
        seen.add(name)
        const url = serverUrl(name)
        const updatedAt = raw._meta?.[OFFICIAL_META]?.updatedAt
        const lastmod = typeof updatedAt === 'string' ? new Date(updatedAt) : undefined
        this.fetcher.prime(url, JSON.stringify(raw), doc.fetchedAt)
        yield { sourceId: this.sourceId, kind: 'server', externalId: name, url, ...(lastmod && !Number.isNaN(lastmod.getTime()) ? { lastmod } : {}) }
        if (limitPerKind !== undefined && seen.size >= limitPerKind) return
      }
      cursor = page.metadata?.nextCursor ?? undefined
    } while (cursor)
  }
}
