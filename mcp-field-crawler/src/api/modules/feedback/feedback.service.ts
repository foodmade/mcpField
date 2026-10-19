import { createHash } from 'node:crypto'
import type { EntityKind } from '../../../core/types.ts'
import type { AuthUser } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import type { FeedbackRepository, FeedbackType } from './feedback.repository.ts'

export const BODY_MAX = 1000
/** 限流：同一账号或同一 IP 10 分钟内最多 5 条 */
const RATE_WINDOW = 10 * 60_000
const RATE_MAX = 5

export const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex')

/** 反馈业务：校验条目和内容、限流；登录了的记下账号，邮箱只在未登录时保存 */
export class FeedbackService {
  constructor(
    private readonly repository: FeedbackRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async create(
    kind: EntityKind,
    slug: string,
    input: { type: FeedbackType; body: string; email?: string },
    from: { user: AuthUser | null; ip: string | null },
  ): Promise<void> {
    const body = input.body.trim()
    if (!body) throw ApiError.badRequest('请写一下具体说明')
    if (body.length > BODY_MAX) throw ApiError.badRequest(`具体说明最多 ${BODY_MAX} 字`)
    const canonical = await this.repository.resolveSlug(kind, slug)
    if (!canonical) throw ApiError.notFound(`条目 "${slug}" 不存在`)

    const by = { userId: from.user?.id ?? null, ipHash: from.ip ? hashIp(from.ip) : null }
    if ((await this.repository.postedSince(by, new Date(this.now() - RATE_WINDOW))) >= RATE_MAX) {
      throw new ApiError(429, 'rate_limited', '提交太频繁了，请稍后再试')
    }
    await this.repository.insert({
      kind,
      slug: canonical,
      type: input.type,
      body,
      email: from.user ? null : input.email?.trim() || null,
      userId: by.userId,
      userName: from.user?.name ?? null,
      ipHash: by.ipHash,
    })
  }
}
