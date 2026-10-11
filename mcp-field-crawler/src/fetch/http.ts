import { HttpError } from '../core/errors.ts'
import type { Fetcher } from '../core/source.ts'
import type { FetchRequest, RawDocument } from '../core/types.ts'

export interface HttpFetcherOptions {
  userAgent: string
  timeoutMs: number
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** 最底层的抓取器：发一次 HTTP 请求，不做重试、限速或 robots 判断（这些由装饰器叠加） */
export class HttpFetcher implements Fetcher {
  constructor(private readonly options: HttpFetcherOptions) {}

  async fetch(request: FetchRequest): Promise<RawDocument> {
    const headers: Record<string, string> = {
      'user-agent': this.options.userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en',
      ...request.headers,
    }
    if (request.conditional?.etag) headers['if-none-match'] = request.conditional.etag
    if (request.conditional?.lastModified) headers['if-modified-since'] = request.conditional.lastModified

    const started = Date.now()
    const response = await fetch(request.url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
    const responseHeaders = Object.fromEntries(response.headers.entries())

    if (response.status === 304) {
      return {
        requestedUrl: request.url,
        url: response.url || request.url,
        status: 304,
        headers: responseHeaders,
        body: '',
        fetchedAt: new Date(),
        durationMs: Date.now() - started,
        notModified: true,
      }
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new HttpError(request.url, response.status, parseRetryAfter(response.headers.get('retry-after')))
    }
    const body = await response.text()
    return {
      requestedUrl: request.url,
      url: response.url || request.url,
      status: response.status,
      headers: responseHeaders,
      body,
      fetchedAt: new Date(),
      durationMs: Date.now() - started,
      notModified: false,
    }
  }
}
