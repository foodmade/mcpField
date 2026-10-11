import { composeFetcher } from '../fetch/compose.ts'
import { HttpFetcher } from '../fetch/http.ts'
import { withRateLimit } from '../fetch/rate-limit.ts'
import { withRetry } from '../fetch/retry.ts'
import { withRobots } from '../fetch/robots.ts'
import { UnsupportedKindError } from './errors.ts'
import type { Discoverer, Fetcher, Mapper, Parser, SourceContext, SourceFactory, SourceMeta } from './source.ts'
import type { EntityKind } from './types.ts'

/**
 * 工厂基类：提供默认的 HTTP 抓取器（按 meta.politeness 叠加重试、robots、限速），
 * 子类只需实现与站点相关的发现、解析、映射。需要浏览器渲染或走 API 的站点覆盖 createFetcher 即可。
 */
export abstract class BaseSourceFactory implements SourceFactory {
  abstract readonly meta: SourceMeta

  createFetcher(ctx: SourceContext): Fetcher {
    const { politeness } = this.meta
    const http = new HttpFetcher({ userAgent: ctx.config.userAgent, timeoutMs: politeness.timeoutMs })
    return composeFetcher(http, [
      withRetry({ maxRetries: politeness.maxRetries, logger: ctx.logger }),
      ...(politeness.respectRobots ? [withRobots({ userAgent: ctx.config.userAgent })] : []),
      withRateLimit({ requestsPerSecond: politeness.requestsPerSecond }),
    ])
  }

  abstract createDiscoverer(ctx: SourceContext, fetcher: Fetcher): Discoverer
  abstract createParser(kind: EntityKind, ctx: SourceContext): Parser
  abstract createMapper(kind: EntityKind, ctx: SourceContext): Mapper

  protected assertKind(kind: EntityKind): void {
    if (!this.meta.kinds.includes(kind)) throw new UnsupportedKindError(this.meta.id, kind)
  }
}
