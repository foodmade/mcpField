import { describe, expect, it } from 'vitest'
import type { Fetcher } from '../src/core/source.ts'
import type { CrawlTarget, FetchRequest } from '../src/core/types.ts'
import { SitemapDiscoverer } from '../src/discover/sitemap.ts'
import { classifyMcpSoUrl, shouldExpandMcpSoSitemap } from '../src/sources/mcpso/urls.ts'

const urlset = (paths: string[]) =>
  `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>https://mcp.so${p}</loc><lastmod>2026-07-01T00:00:00Z</lastmod></url>`).join('')}</urlset>`

const SITES: Record<string, string> = {
  'https://mcp.so/sitemap.xml': `<?xml version="1.0"?><sitemapindex>
    <sitemap><loc>https://mcp.so/sitemap.xml?section=static</loc></sitemap>
    <sitemap><loc>https://mcp.so/sitemap.xml?section=cli</loc></sitemap>
    <sitemap><loc>https://mcp.so/sitemap.xml?section=servers&amp;page=1</loc></sitemap>
    <sitemap><loc>https://mcp.so/sitemap.xml?section=servers&amp;page=2</loc></sitemap>
  </sitemapindex>`,
  'https://mcp.so/sitemap.xml?section=static': urlset(['/', '/servers']),
  'https://mcp.so/sitemap.xml?section=cli': urlset(['/cli/gh', '/cli/glab', '/zh/cli/gh']),
  'https://mcp.so/sitemap.xml?section=servers&page=1': urlset(['/servers/a', '/servers/b', '/servers/a']),
  'https://mcp.so/sitemap.xml?section=servers&page=2': urlset(['/servers/c']),
}

function fakeFetcher() {
  const requested: string[] = []
  const fetcher: Fetcher = {
    async fetch(req: FetchRequest) {
      requested.push(req.url)
      const body = SITES[req.url]
      if (!body) throw new Error('unexpected ' + req.url)
      return { requestedUrl: req.url, url: req.url, status: 200, headers: {}, body, fetchedAt: new Date(), durationMs: 0, notModified: false }
    },
  }
  return { fetcher, requested }
}

async function collect(iter: AsyncIterable<CrawlTarget>) {
  const out: CrawlTarget[] = []
  for await (const t of iter) out.push(t)
  return out
}

const discoverer = (fetcher: Fetcher) =>
  new SitemapDiscoverer(fetcher, {
    sourceId: 'mcpso',
    root: 'https://mcp.so/sitemap.xml',
    classify: classifyMcpSoUrl,
    shouldExpand: shouldExpandMcpSoSitemap,
  })

describe('SitemapDiscoverer', () => {
  it('展开索引、按类型分类、去重、忽略多语言副本和非详情页', async () => {
    const { fetcher } = fakeFetcher()
    const targets = await collect(discoverer(fetcher).discover({ kinds: ['server', 'cli'] }))
    expect(targets.map((t) => `${t.kind}:${t.externalId}`)).toEqual(['cli:gh', 'cli:glab', 'server:a', 'server:b', 'server:c'])
    expect(targets[0]!.lastmod?.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('只下载需要的分区；每种类型达到上限后不再下载剩余分区', async () => {
    const { fetcher, requested } = fakeFetcher()
    const targets = await collect(discoverer(fetcher).discover({ kinds: ['server'], limitPerKind: 2 }))
    expect(targets.map((t) => t.externalId)).toEqual(['a', 'b'])
    expect(requested).toEqual(['https://mcp.so/sitemap.xml', 'https://mcp.so/sitemap.xml?section=servers&page=1'])
  })

  it('按 lastmod 做增量过滤', async () => {
    const { fetcher } = fakeFetcher()
    const targets = await collect(discoverer(fetcher).discover({ kinds: ['cli'], since: new Date('2026-08-01') }))
    expect(targets).toEqual([])
  })
})
