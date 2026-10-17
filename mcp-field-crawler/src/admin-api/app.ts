import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { STAGES } from '../admin/sync.ts'
import { ApiError } from '../api/http/errors.ts'
import { parseQuery } from '../api/http/query.ts'
import type { Logger } from '../core/logger.ts'
import { ENTITY_KINDS } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import type { AssetStorage } from '../assets/storage.ts'
import { RUNNABLE_STEPS, type AdminActions } from './actions.ts'
import { adminBlogRoutes, type BlogTranslations } from './blog.ts'
import { blogAiRoutes } from './blog-ai.ts'
import { SettingsStore, settingsRoutes } from './settings.ts'
import { SESSION_TTL_MS, type AdminAuth, type AdminUser } from './auth.ts'
import { dailyRun, dashboard, itemFacets, listItems, runDetail } from './queries.ts'

/*
 * 管理后台接口（独立进程，只监听本机，经 Nginx 的 admin.mcpfield.com 访问）：
 *   POST /api/admin/auth/login | logout | password，GET /api/admin/auth/me
 *   GET  /api/admin/dashboard、/api/admin/daily?date、/api/admin/runs/:id、/api/admin/items、/api/admin/items/facets、/api/admin/logs/:name
 *   POST /api/admin/actions/run（单步）、/api/admin/actions/daily（整套每日任务）
 *   /api/admin/blog/*：博客文章的增删改查、图片上传（见 blog.ts）；/api/admin/blog/ai/*：AI 生成（见 blog-ai.ts）
 *   /api/admin/settings/*：后台可修改的配置（博客 AI 的模型服务，见 settings.ts）
 * 除登录外都要登录；改动类请求另外校验 Origin（csrf 中间件），会话 cookie 是 HttpOnly + SameSite=Strict。
 */

export interface AdminApiDeps {
  db: Db
  auth: AdminAuth
  actions: AdminActions
  logger: Logger
  origins: string[]
  cookieSecure: boolean
  siteUrl: string
  /** 博客图片上传到的对象存储；没配置 R2 时不能上传 */
  storage?: AssetStorage
  /** 博客翻译队列（保存已发布文章后排队、唤醒翻译任务） */
  blogTranslations: BlogTranslations
}

const COOKIE = 'mf_admin'

type Env = { Variables: { user: AdminUser; sessionId: number } }

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式为 YYYY-MM-DD')

const itemsQuerySchema = z.object({
  kind: z.enum(ENTITY_KINDS).optional(),
  date: dateSchema.optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  category: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .max(64)
    .optional(),
  source: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .max(32)
    .optional(),
  issue: z.enum(['fail', 'warn', 'pending']).optional(),
  stage: z.enum(STAGES).optional(),
  stageState: z.enum(['na', 'pending', 'ok', 'warn', 'failed']).optional(),
  sort: z.enum(['new', 'popular', 'name']).default('new'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const result = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!result.success) throw ApiError.badRequest('请求内容不合法', result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })))
  return result.data
}

export function createAdminApp(deps: AdminApiDeps) {
  const app = new Hono<Env>()
  const { db, auth } = deps

  app.use('*', secureHeaders())
  app.use('*', async (c, next) => {
    const started = Date.now()
    await next()
    c.header('Cache-Control', 'no-store')
    deps.logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, 'request')
  })
  app.use('/api/admin/*', csrf({ origin: deps.origins }))

  app.get('/api/admin/health', (c) => c.json({ status: 'ok' }))

  const cookieOptions = { httpOnly: true, secure: deps.cookieSecure, sameSite: 'Strict' as const, path: '/' }

  app.post('/api/admin/auth/login', async (c) => {
    const input = await body(c, z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) }))
    const { token, user } = await auth.login(input.username, input.password, {
      ip: c.req.header('x-real-ip') ?? c.req.header('cf-connecting-ip'),
      userAgent: c.req.header('user-agent'),
    })
    setCookie(c, COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_MS / 1000 })
    deps.logger.info({ username: user.username }, '后台登录')
    return c.json({ data: user })
  })

  // 以下接口都要登录
  app.use('/api/admin/*', async (c, next) => {
    if (c.req.path === '/api/admin/auth/login' || c.req.path === '/api/admin/health') return next()
    const session = await auth.authenticate(getCookie(c, COOKIE))
    if (!session) throw new ApiError(401, 'unauthorized', '请先登录')
    c.set('user', session.user)
    c.set('sessionId', session.sessionId)
    return next()
  })

  app.get('/api/admin/auth/me', (c) => c.json({ data: c.get('user') }))

  app.post('/api/admin/auth/logout', async (c) => {
    await auth.logout(getCookie(c, COOKIE))
    deleteCookie(c, COOKIE, cookieOptions)
    return c.json({ data: { ok: true } })
  })

  app.post('/api/admin/auth/password', async (c) => {
    const input = await body(c, z.object({ current: z.string().min(1).max(128), next: z.string().min(1).max(128) }))
    await auth.changePassword(c.get('user').id, c.get('sessionId'), input.current, input.next)
    deps.logger.info({ username: c.get('user').username }, '后台账号已修改密码')
    return c.json({ data: { ok: true } })
  })

  app.get('/api/admin/dashboard', async (c) => c.json({ data: await dashboard(db) }))

  app.get('/api/admin/daily', async (c) => {
    const { date } = parseQuery(c, z.object({ date: dateSchema.optional() }))
    return c.json({ data: await dailyRun(db, date ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)) })
  })

  app.get('/api/admin/runs/:id', async (c) => {
    const run = await runDetail(db, Number(c.req.param('id')))
    if (!run) throw ApiError.notFound('运行记录不存在')
    return c.json({ data: run })
  })

  app.get('/api/admin/items', async (c) => c.json(await listItems(db, parseQuery(c, itemsQuerySchema), deps.siteUrl)))

  app.get('/api/admin/items/facets', async (c) => {
    const { kind } = parseQuery(c, z.object({ kind: z.enum(ENTITY_KINDS) }))
    return c.json({ data: await itemFacets(db, kind) })
  })

  app.get('/api/admin/logs/:name', async (c) => {
    const name = c.req.param('name')
    if (name !== 'daily' && !(RUNNABLE_STEPS as readonly string[]).includes(name)) throw ApiError.notFound('没有这个日志')
    const { lines } = parseQuery(c, z.object({ lines: z.coerce.number().int().min(10).max(5000).default(500) }))
    return c.json({ data: await deps.actions.tail(name as 'daily', lines) })
  })

  app.post('/api/admin/actions/run', async (c) => {
    const { step } = await body(c, z.object({ step: z.enum(RUNNABLE_STEPS) }))
    await deps.actions.runStep(step)
    deps.logger.info({ username: c.get('user').username, step }, '后台手动运行')
    return c.json({ data: { ok: true } })
  })

  app.post('/api/admin/actions/daily', async (c) => {
    const { steps } = await body(c, z.object({ steps: z.array(z.enum(RUNNABLE_STEPS)).max(20).default([]) }))
    await deps.actions.runDaily(steps)
    deps.logger.info({ username: c.get('user').username, steps }, '后台手动运行每日任务')
    return c.json({ data: { ok: true } })
  })

  const settings = new SettingsStore(db)
  app.route('/api/admin/settings', settingsRoutes({ store: settings, logger: deps.logger }))
  app.route('/api/admin/blog/ai', blogAiRoutes({ db, settings, storage: deps.storage, logger: deps.logger }))
  app.route('/api/admin/blog', adminBlogRoutes({ db, storage: deps.storage, logger: deps.logger, siteUrl: deps.siteUrl, translations: deps.blogTranslations }))

  app.notFound((c) => c.json({ error: { code: 'not_found', message: `接口不存在：${c.req.method} ${c.req.path}` } }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status)
    // csrf 中间件拒绝时抛的是 HTTPException
    const status = (err as { status?: number }).status
    if (status === 403) return c.json({ error: { code: 'forbidden', message: '请求来源不被允许' } }, 403)
    deps.logger.error({ path: c.req.path, err: err.message }, '接口异常')
    return c.json({ error: { code: 'internal_error', message: '服务器内部错误' } }, 500)
  })

  return app
}
