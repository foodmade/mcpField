import { XMLParser } from 'fast-xml-parser'
import type { DiscoverOptions, Discoverer, Fetcher } from '../core/source.ts'
import type { CrawlTarget, EntityKind } from '../core/types.ts'

interface SitemapEntry {
  loc: string
  lastmod?: Date
}

type ParsedSitemap = { type: 'index'; entries: SitemapEntry[] } | { type: 'urlset'; entries: SitemapEntry[] }

const xml = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === 'url' || name === 'sitemap',
})

function toEntry(node: { loc?: unknown; lastmod?: unknown }): SitemapEntry | undefined {
  if (typeof node.loc !== 'string') return undefined
  const lastmod = typeof node.lastmod === 'string' ? new Date(node.lastmod) : undefined
  return { loc: node.loc.trim(), ...(lastmod && !Number.isNaN(lastmod.getTime()) ? { lastmod } : {}) }
}

export function parseSitemap(body: string): ParsedSitemap {
  const doc = xml.parse(body) as {
    sitemapindex?: { sitemap?: { loc?: unknown; lastmod?: unknown }[] }
    urlset?: { url?: { loc?: unknown; lastmod?: unknown }[] }
  }
  if (doc.sitemapindex) {
    return { type: 'index', entries: (doc.sitemapindex.sitemap ?? []).map(toEntry).filter((e) => e !== undefined) }
  }
  return { type: 'urlset', entries: (doc.urlset?.url ?? []).map(toEntry).filter((e) => e !== undefined) }
}

export interface SitemapDiscovererOptions {
  sourceId: string
  /** 入口站点地图（通常是 /sitemap.xml，可以是索引） */
  root: string
  /** 把一个页面地址归类为某种实体；返回 null 表示不是详情页，忽略 */
  classify(url: URL): { kind: EntityKind; externalId: string } | null
  /** 是否展开某个子站点地图；可按类型裁剪，避免下载用不到的分区 */
  shouldExpand?(sitemapUrl: URL, wantedKinds: readonly EntityKind[]): boolean
}

/**
 * 通用的站点地图发现器：广度优先展开站点地图索引，逐条产出详情页目标。
 * 惰性执行：达到数量上限后不再下载剩余的站点地图。
 */
export class SitemapDiscoverer implements Discoverer {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly options: SitemapDiscovererOptions,
  ) {}

  async *discover({ kinds, limitPerKind, since, signal }: DiscoverOptions): AsyncIterable<CrawlTarget> {
    const counts = new Map<EntityKind, number>()
    const wanted = () => kinds.filter((k) => limitPerKind === undefined || (counts.get(k) ?? 0) < limitPerKind)
    const seen = new Set<string>()
    const queue = [this.options.root]

    while (queue.length > 0 && wanted().length > 0) {
      if (signal?.aborted) return
      const sitemapUrl = queue.shift()!
      const doc = await this.fetcher.fetch({ url: sitemapUrl, headers: { accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' } })
      const parsed = parseSitemap(doc.body)

      if (parsed.type === 'index') {
        for (const child of parsed.entries) {
          const expand = this.options.shouldExpand?.(new URL(child.loc), wanted()) ?? true
          if (expand) queue.push(child.loc)
        }
        continue
      }

      for (const entry of parsed.entries) {
        if (seen.has(entry.loc)) continue
        seen.add(entry.loc)
        if (since && entry.lastmod && entry.lastmod <= since) continue

        const hit = this.options.classify(new URL(entry.loc))
        if (!hit || !wanted().includes(hit.kind)) continue

        counts.set(hit.kind, (counts.get(hit.kind) ?? 0) + 1)
        yield {
          sourceId: this.options.sourceId,
          kind: hit.kind,
          externalId: hit.externalId,
          url: entry.loc,
          ...(entry.lastmod ? { lastmod: entry.lastmod } : {}),
        }
        if (wanted().length === 0) return
      }
    }
  }
}
