import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AuthUser, AuthVerifier } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import { localeQuerySchema, parseQuery } from '../../http/query.ts'
import { KEY_PREFIX, type ApiKeyService } from '../keys/key.service.ts'
import { IMPORT_MAX, type FavoriteService } from './favorite.service.ts'

const addSchema = z.object({ favoritedAt: z.iso.datetime().optional() })
const importSchema = z.object({ keys: z.array(z.string().max(220)).max(IMPORT_MAX) })

const slugOf = (c: Context): string => {
  const slug = c.req.param('slug') ?? ''
  if (!slug || slug.length > 191) throw ApiError.notFound('条目不存在')
  return slug
}

const bodyOf = async <S extends z.ZodType>(c: Context, schema: S, fallback?: unknown): Promise<z.infer<S>> => {
  const raw = await c.req.json().catch(() => fallback ?? null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw ApiError.badRequest('请求内容不合法', parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
  return parsed.data
}

/**
 * 收藏接口（挂在 /api/favorites 下），只能读写自己的收藏。令牌可以是网站登录令牌（Supabase），
 * 也可以是 API 密钥（mf_ 开头，MCP 服务用，同时用 X-MCPField-Client 报上客户端名称）。
 * GET    /?locale              全部收藏（最近收藏的在前），每条带目录列表项；已下架的 item 为 null
 * GET    /keys                 收藏了的条目标识（server:slug），详情页判断是否已收藏
 * PUT    /:kind/:slug          收藏：{ favoritedAt? }（撤销取消收藏时恢复原来的时间）
 * DELETE /:kind/:slug          取消收藏
 * POST   /import               并入浏览器本地的收藏：{ keys }，返回并入后的全部标识
 * 响应都带 Cache-Control: private, no-store。
 */
export function favoriteRoutes(service: FavoriteService, auth: AuthVerifier | undefined, apiKeys?: ApiKeyService) {
  const requireUser = async (c: Context): Promise<AuthUser> => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (apiKeys && token.startsWith(KEY_PREFIX)) return apiKeys.authenticate(token, c.req.header('x-mcpfield-client'))
    if (!auth) throw new ApiError(503, 'auth_unavailable', '登录服务未配置，暂时不能收藏')
    const user = token ? await auth.verify(token) : null
    if (!user) throw new ApiError(401, 'unauthorized', '请先登录')
    return user
  }

  return new Hono()
    .use('*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'private, no-store')
    })
    .use('*', bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, 'payload_too_large', '请求内容太大') } }))
    .get('/', async (c) => {
      const user = await requireUser(c)
      return c.json({ data: await service.list(user, parseQuery(c, localeQuerySchema).locale) })
    })
    .get('/keys', async (c) => c.json({ data: await service.keys(await requireUser(c)) }))
    .post('/import', async (c) => {
      const user = await requireUser(c)
      const { keys } = await bodyOf(c, importSchema)
      return c.json({ data: await service.import(user, keys) })
    })
    .put('/:kind/:slug', async (c) => {
      const slug = slugOf(c)
      const user = await requireUser(c)
      const { favoritedAt } = await bodyOf(c, addSchema, {})
      return c.json({ data: await service.add(user, c.req.param('kind'), slug, favoritedAt) })
    })
    .delete('/:kind/:slug', async (c) => {
      const slug = slugOf(c)
      await service.remove(await requireUser(c), c.req.param('kind'), slug)
      return c.body(null, 204)
    })
}
