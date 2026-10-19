import type { Kind } from './api/entities'
import { apiSend } from './api/http'
import { accessToken } from './auth'

/* 详情页的问题反馈：与后端 mcp-field-crawler/src/api/modules/feedback 对应 */

export const FEEDBACK_TYPES = ['wrong_info', 'broken_link', 'install', 'duplicate', 'suggestion', 'other'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]
export const FEEDBACK_MAX = 1000

/** 提交反馈；不需要登录，登录了的带上令牌记下账号 */
export async function sendFeedback(kind: Kind, slug: string, input: { type: FeedbackType; body: string; email?: string }): Promise<void> {
  await apiSend('POST', `/feedback/${kind}/${encodeURIComponent(slug)}`, input, await accessToken())
}
