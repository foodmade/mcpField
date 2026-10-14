import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { isEntityKind, type EntityKind } from '../../../core/types.ts'
import type { AuthUser, AuthVerifier } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import { parseQuery } from '../../http/query.ts'
import { COMMENT_SORTS, REACTIONS, type Reaction } from './comment.repository.ts'
import { BODY_MAX, type CommentService } from './comment.service.ts'

const listSchema = z.object({
  sort: z.enum(COMMENT_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

const createSchema = z.object({
  body: z.string().max(BODY_MAX * 2),
  parentId: z.coerce.number().int().positive().optional(),
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

const idOf = (c: Context): number => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('评论不存在')
  return id
}

const reactionOf = (c: Context): Reaction => {
  const r = c.req.param('reaction') ?? ''
  if (!(REACTIONS as readonly string[]).includes(r)) throw ApiError.badRequest(`不支持的回应 "${r}"`)
  return r as Reaction
}

/**
 * 评论接口（挂在 /api/comments 下）。读接口不需要登录，带了令牌时返回自己的回应和可删除标记；写接口需要 Supabase 登录令牌。
 * GET    /:kind/:slug                      列表：sort（newest / oldest / top）, page, pageSize；每条顶层评论带全部回复
 * POST   /:kind/:slug                      发表：{ body, parentId? }
 * DELETE /:id                              删除自己的评论（回复一起删除）
 * PUT    /:id/reactions/:reaction          添加回应（up / party / heart / rocket）
 * DELETE /:id/reactions/:reaction          取消回应
 * 响应都带 Cache-Control: private, no-store，不让 CDN 缓存。
 */
export function commentRoutes(service: CommentService, auth: AuthVerifier | undefined) {
  const viewer = async (c: Context): Promise<AuthUser | null> => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    return token && auth ? auth.verify(token) : null
  }
  const requireUser = async (c: Context): Promise<AuthUser> => {
    if (!auth) throw new ApiError(503, 'auth_unavailable', '登录服务未配置，暂时不能评论')
    const user = await viewer(c)
    if (!user) throw new ApiError(401, 'unauthorized', '请先登录')
    return user
  }

  return new Hono()
    .use('*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'private, no-store')
    })
    .use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, 'payload_too_large', '请求内容太大') } }))
    .get('/:kind/:slug', async (c) => {
      const kind = kindOf(c)
      return c.json(await service.list(kind, slugOf(c), parseQuery(c, listSchema), await viewer(c)))
    })
    .post('/:kind/:slug', async (c) => {
      const kind = kindOf(c)
      const slug = slugOf(c)
      const user = await requireUser(c)
      const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw ApiError.badRequest('请求内容不合法', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
      return c.json({ data: await service.create(kind, slug, parsed.data, user) }, 201)
    })
    .delete('/:id', async (c) => {
      const id = idOf(c)
      await service.remove(id, await requireUser(c))
      return c.body(null, 204)
    })
    .put('/:id/reactions/:reaction', async (c) => {
      const id = idOf(c)
      const reaction = reactionOf(c)
      return c.json({ data: await service.react(id, reaction, true, await requireUser(c)) })
    })
    .delete('/:id/reactions/:reaction', async (c) => {
      const id = idOf(c)
      const reaction = reactionOf(c)
      return c.json({ data: await service.react(id, reaction, false, await requireUser(c)) })
    })
}
