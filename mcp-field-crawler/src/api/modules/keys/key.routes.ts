import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AuthUser, AuthVerifier } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import { NAME_MAX, type ApiKeyService } from './key.service.ts'

const createSchema = z.object({
  name: z.string().max(NAME_MAX * 4),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
})
const renameSchema = z.object({ name: z.string().max(NAME_MAX * 4) })

const idOf = (c: Context): number => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) throw ApiError.notFound('密钥不存在')
  return id
}

const bodyOf = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw ApiError.badRequest('请求内容不合法', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
  return parsed.data
}

/**
 * API 密钥管理（挂在 /api/keys 下）：只接受网站登录令牌（Supabase），不能用 API 密钥管理密钥。
 * GET    /         自己的全部密钥（含已过期的），只给提示，不给完整密钥
 * POST   /         创建：{ name, expiresInDays: 30 | 90 | 365 | null }，返回完整密钥（只这一次）
 * PUT    /:id      重命名：{ name }
 * DELETE /:id      撤销（删除），过期的也用它删
 * 响应都带 Cache-Control: private, no-store。
 */
export function keyRoutes(service: ApiKeyService, auth: AuthVerifier | undefined) {
  const requireUser = async (c: Context): Promise<AuthUser> => {
    if (!auth) throw new ApiError(503, 'auth_unavailable', '登录服务未配置')
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const user = token ? await auth.verify(token) : null
    if (!user) throw new ApiError(401, 'unauthorized', '请先登录')
    return user
  }

  return new Hono()
    .use('*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'private, no-store')
    })
    .use('*', bodyLimit({ maxSize: 16 * 1024, onError: () => { throw new ApiError(413, 'payload_too_large', '请求内容太大') } }))
    .get('/', async (c) => c.json({ data: await service.list(await requireUser(c)) }))
    .post('/', async (c) => {
      const user = await requireUser(c)
      return c.json({ data: await service.create(user, await bodyOf(c, createSchema)) }, 201)
    })
    .put('/:id', async (c) => {
      const id = idOf(c)
      const user = await requireUser(c)
      const { name } = await bodyOf(c, renameSchema)
      return c.json({ data: await service.rename(user, id, name) })
    })
    .delete('/:id', async (c) => {
      const id = idOf(c)
      await service.remove(await requireUser(c), id)
      return c.body(null, 204)
    })
}
