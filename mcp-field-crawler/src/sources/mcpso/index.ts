import { BaseSourceFactory } from '../../core/base-source.ts'
import type { Discoverer, Fetcher, Mapper, Parser, SourceMeta } from '../../core/source.ts'
import { ENTITY_KINDS, type EntityKind } from '../../core/types.ts'
import { SitemapDiscoverer } from '../../discover/sitemap.ts'
import { McpSoMapper } from './mapper.ts'
import { McpSoDetailParser } from './parser.ts'
import { classifyMcpSoUrl, MCPSO_ORIGIN, MCPSO_SITEMAP, shouldExpandMcpSoSitemap } from './urls.ts'

/** mcp.so 的具体工厂：站点地图发现 + TanStack 内嵌数据解析 + 细粒度映射 */
export class McpSoFactory extends BaseSourceFactory {
  readonly meta: SourceMeta = {
    id: 'mcpso',
    name: 'MCP.so',
    homepage: MCPSO_ORIGIN,
    kinds: ENTITY_KINDS,
    politeness: { requestsPerSecond: 1, concurrency: 2, respectRobots: true, maxRetries: 4, timeoutMs: 30_000 },
  }

  createDiscoverer(_ctx: unknown, fetcher: Fetcher): Discoverer {
    return new SitemapDiscoverer(fetcher, {
      sourceId: this.meta.id,
      root: MCPSO_SITEMAP,
      classify: classifyMcpSoUrl,
      shouldExpand: shouldExpandMcpSoSitemap,
    })
  }

  createParser(kind: EntityKind): Parser {
    this.assertKind(kind)
    return new McpSoDetailParser(kind)
  }

  createMapper(kind: EntityKind): Mapper {
    this.assertKind(kind)
    return new McpSoMapper(kind)
  }
}
