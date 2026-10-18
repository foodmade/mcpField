import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AuthUser, AuthVerifier } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import { safeReturnTo, type ClaimService } from './claim.service.ts'

/** 发起认领时写入、GitHub 跳回时比对的随机数 */
const COOKIE = 'mf_claim'

const slugOf = (c: Context): string => {
  const slug = c.req.param('slug') ?? ''
  if (!slug || slug.length > 191) throw ApiError.notFound('条目不存在')
  return slug
}

/** 在站内地址上带上 ?claim=结果，去掉之前的 claim 参数 */
function withResult(path: string, result: string): string {
  const url = new URL(path, 'http://site')
  url.searchParams.set('claim', result)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * MCP 服务认领（挂在 /api/claims 下）：
 * GET  /servers/:slug          认领状态：能否认领、认领人、是不是自己认领的（带令牌时）
 * POST /servers/:slug/start    发起认领（需要登录）：{ returnTo } → { url }，浏览器跳到 url（GitHub 授权页）
 * GET  /github/callback        GitHub 跳回：验证后 302 回到 returnTo?claim=ok|cancelled|expired|denied|taken|revoked|error
 * 响应都带 Cache-Control: private, no-store。
 */
export function claimRoutes(service: ClaimService, auth: AuthVerifier | undefined, options: { cookieSecure: boolean }) {
  const viewer = async (c: Context): Promise<AuthUser | null> => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    return token && auth ? auth.verify(token) : null
  }
  const cookieOptions = { httpOnly: true, secure: options.cookieSecure, sameSite: 'Lax' as const, path: '/api/claims' }

  return new Hono()
    .use('*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'private, no-store')
    })
    .get('/servers/:slug', async (c) => c.json({ data: await service.status(slugOf(c), await viewer(c)) }))
    .post('/servers/:slug/start', async (c) => {
      const slug = slugOf(c)
      if (!auth) throw new ApiError(503, 'auth_unavailable', '登录服务未配置，暂时不能认领')
      const user = await viewer(c)
      if (!user) throw new ApiError(401, 'unauthorized', '请先登录')
      const body = (await c.req.json().catch(() => null)) as { returnTo?: unknown } | null
      const returnTo = safeReturnTo(typeof body?.returnTo === 'string' ? body.returnTo : null) ?? `/servers/${encodeURIComponent(slug)}`
      const { url, nonce } = await service.start(slug, user, returnTo)
      setCookie(c, COOKIE, nonce, { ...cookieOptions, maxAge: 600 })
      return c.json({ data: { url } })
    })
    .get('/github/callback', async (c) => {
      const { code, state, error } = c.req.query()
      const nonce = getCookie(c, COOKIE)
      deleteCookie(c, COOKIE, cookieOptions)
      const { returnTo, result } = await service.complete({ code, state, error }, nonce, '/servers')
      return c.redirect(withResult(returnTo, result), 302)
    })
}
