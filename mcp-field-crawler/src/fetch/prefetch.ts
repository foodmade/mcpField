import type { Fetcher } from '../core/source.ts'
import type { FetchRequest, RawDocument } from '../core/types.ts'

/**
 * 预取抓取器：列表接口已经带了每个条目的完整数据时（官方 MCP Registry），
 * 发现器把条目按详情地址放进来，抓取阶段直接取用，不再逐个请求详情接口；没有预取到的照常交给下层抓取器。
 *
 * 发现与抓取是交替进行的（运行器有背压，在途目标不超过并发数），预取的条目很快就会被取走；
 * lastmod 没变而被跳过的条目不会被取走，所以按容量淘汰最早放入的，避免内存一直增长。
 */
export class PrefetchFetcher implements Fetcher {
  private readonly docs = new Map<string, { body: string; fetchedAt: Date; contentType: string }>()

  constructor(
    private readonly inner: Fetcher,
    private readonly capacity = 1000,
  ) {}

  prime(url: string, body: string, fetchedAt: Date, contentType = 'application/json'): void {
    this.docs.delete(url)
    this.docs.set(url, { body, fetchedAt, contentType })
    if (this.docs.size > this.capacity) this.docs.delete(this.docs.keys().next().value!)
  }

  async fetch(request: FetchRequest): Promise<RawDocument> {
    const hit = this.docs.get(request.url)
    if (!hit) return this.inner.fetch(request)
    this.docs.delete(request.url)
    return {
      requestedUrl: request.url,
      url: request.url,
      status: 200,
      headers: { 'content-type': hit.contentType },
      body: hit.body,
      fetchedAt: hit.fetchedAt,
      durationMs: 0,
      notModified: false,
    }
  }
}
