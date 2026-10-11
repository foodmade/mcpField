import type { Fetcher } from '../core/source.ts'

/** 抓取中间件：包装一个抓取器并返回新的抓取器（装饰器模式） */
export type FetchMiddleware = (next: Fetcher) => Fetcher

/**
 * 按"从外到内"的顺序叠加中间件：
 * composeFetcher(http, [retry, robots, rateLimit]) 的调用链是 retry → robots → rateLimit → http，
 * 因此每次重试都会重新经过限速。
 */
export function composeFetcher(base: Fetcher, middlewares: FetchMiddleware[]): Fetcher {
  return middlewares.reduceRight<Fetcher>((next, middleware) => middleware(next), base)
}
