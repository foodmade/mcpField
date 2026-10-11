import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** 业务错误：统一转换成 { error: { code, message } } 响应 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static notFound(message = '资源不存在'): ApiError {
    return new ApiError(404, 'not_found', message)
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', message, details)
  }
}
