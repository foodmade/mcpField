import { BaseSourceFactory } from '../../core/base-source.ts'
import type { Discoverer, Fetcher, Mapper, Parser, SourceContext, SourceMeta } from '../../core/source.ts'
import type { EntityKind } from '../../core/types.ts'
import { PrefetchFetcher } from '../../fetch/prefetch.ts'
import { RegistryDiscoverer } from './discoverer.ts'
import { RegistryServerMapper } from './mapper.ts'
import { RegistryServerParser } from './parser.ts'
import { REGISTRY_ORIGIN } from './urls.ts'

/** 官方 MCP Registry：翻列表接口发现 + 列表条目直接预取 + server.json 映射。只有 MCP 服务一种类型 */
export class McpRegistryFactory extends BaseSourceFactory {
  readonly meta: SourceMeta = {
    id: 'mcp-registry',
    name: 'MCP Registry',
    homepage: REGISTRY_ORIGIN,
    kinds: ['server'],
    // 实际请求只有列表页（每页 100 条），详情都从列表预取；超时放宽给偶尔走到的详情接口（实测 40–60 秒）
    politeness: { requestsPerSecond: 1, concurrency: 4, respectRobots: true, maxRetries: 4, timeoutMs: 120_000 },
  }

  override createFetcher(ctx: SourceContext): Fetcher {
    return new PrefetchFetcher(super.createFetcher(ctx))
  }

  createDiscoverer(_ctx: SourceContext, fetcher: Fetcher): Discoverer {
    if (!(fetcher instanceof PrefetchFetcher)) throw new Error('mcp-registry 的发现器需要 PrefetchFetcher')
    return new RegistryDiscoverer(fetcher, this.meta.id)
  }

  createParser(kind: EntityKind): Parser {
    this.assertKind(kind)
    return new RegistryServerParser()
  }

  createMapper(kind: EntityKind): Mapper {
    this.assertKind(kind)
    return new RegistryServerMapper()
  }
}
