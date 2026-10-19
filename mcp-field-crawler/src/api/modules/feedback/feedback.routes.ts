import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { isEntityKind, type EntityKind } from '../../../core/types.ts'
import type { AuthUser, AuthVerifier } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import { FEEDBACK_TYPES } from './feedback.repository.ts'
import { BODY_MAX, type FeedbackService } from './feedback.service.ts'

const createSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  body: z.string().max(BODY_MAX * 2),
  email: z.union([z.literal(''), z.email().max(255)]).optional(),
})

const kindOf = (c: Context): EntityKind => {
  const kind = c.req.param('kind') ?? ''
  if (!isEntityKind(kind)) throw ApiError.notFound(`类型 "${kind}" 不存在`)
  return kind
}

const slugOf = (c: Context): string => {
  const slug = c.req.param('slug') ?? ''
  if (!slug || slug.length > 191) throw ApiError.notFound('条目不存在')
  return slug
}

/**
 * 问题反馈（挂在 /api/feedback 下）：
 * POST /:kind/:slug    提交：{ type, body, email? }；不需要登录，带了令牌时记下账号
 * 访客 IP 取 Cloudflare 的 CF-Connecting-IP（经 Nginx 和前端服务原样转发），没有时用 X-Real-IP。
 */
export function feedbackRoutes(service: FeedbackService, auth: AuthVerifier | undefined) {
  const viewer = async (c: Context): Promise<AuthUser | null> => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    return token && auth ? auth.verify(token) : null
  }

  return new Hono()
    .use('*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'private, no-store')
    })
    .use('*', bodyLimit({ maxSize: 16 * 1024, onError: () => { throw new ApiError(413, 'payload_too_large', '请求内容太大') } }))
    .post('/:kind/:slug', async (c) => {
      const kind = kindOf(c)
      const slug = slugOf(c)
      const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw ApiError.badRequest('请求内容不合法', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
      const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? null
      await service.create(kind, slug, parsed.data, { user: await viewer(c), ip })
      return c.body(null, 204)
    })
}
