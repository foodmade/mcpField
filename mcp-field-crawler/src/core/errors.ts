export class CrawlerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = new.target.name
  }
}

export class HttpError extends CrawlerError {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} ${url}`)
  }

  /** 408 / 425 / 429 / 5xx 视为临时错误，可以重试 */
  get retryable(): boolean {
    return this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500
  }

  /** 404 / 410：目标已不存在 */
  get gone(): boolean {
    return this.status === 404 || this.status === 410
  }
}

export class RobotsDisallowedError extends CrawlerError {
  constructor(readonly url: string) {
    super(`robots.txt 不允许抓取 ${url}`)
  }
}

export class ParseError extends CrawlerError {
  constructor(
    readonly url: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${message}（${url}）`, options)
  }
}

export class UnknownSourceError extends CrawlerError {
  constructor(id: string, known: string[]) {
    super(`未知数据源 "${id}"，可用：${known.join(', ') || '无'}`)
  }
}

export class UnsupportedKindError extends CrawlerError {
  constructor(sourceId: string, kind: string) {
    super(`数据源 "${sourceId}" 不支持类型 "${kind}"`)
  }
}
