import { HttpError } from '../../core/errors.ts'
import type { Fetcher } from '../../core/source.ts'
import type { FetchRequest, RawDocument } from '../../core/types.ts'
import { auditUrlFor } from './urls.ts'

/**
 * 抓取一个 skill 时，把三份数据合成一份文档：发现器预先放入的排行榜条目、详情（含 SKILL.md 等文件）、安全审计。
 * 列表页等其他地址直接交给下层抓取器。没有审计结果（404）时审计为空。
 */
export class SkillsShFetcher implements Fetcher {
  private readonly listings = new Map<string, unknown>()

  constructor(
    private readonly inner: Fetcher,
    private readonly capacity = 1000,
  ) {}

  /** 发现器调用：记下排行榜条目，抓取该 skill 时合并进文档；按容量淘汰最早的（跳过的目标不会被取走） */
  remember(url: string, listing: unknown): void {
    this.listings.delete(url)
    this.listings.set(url, listing)
    if (this.listings.size > this.capacity) this.listings.delete(this.listings.keys().next().value!)
  }

  async fetch(request: FetchRequest): Promise<RawDocument> {
    const listing = this.listings.get(request.url)
    if (listing === undefined) return this.inner.fetch(request)
    this.listings.delete(request.url)

    const detail = await this.inner.fetch({ url: request.url })
    const audits = await this.inner.fetch({ url: auditUrlFor(request.url) }).then(
      (doc) => (JSON.parse(doc.body) as { audits?: unknown[] }).audits ?? [],
      (error: unknown) => {
        if (error instanceof HttpError && error.status === 404) return []
        throw error
      },
    )
    return { ...detail, body: JSON.stringify({ listing, skill: JSON.parse(detail.body) as unknown, audits }) }
  }
}
