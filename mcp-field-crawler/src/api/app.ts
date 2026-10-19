import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { AuthVerifier } from './auth/supabase-auth.ts'
import { ApiError } from './http/errors.ts'
import { localeQuerySchema, parseQuery, sitemapQuerySchema, tagsQuerySchema } from './http/query.ts'
import { blogRoutes } from './modules/blog/blog.routes.ts'
import { claimRoutes } from './modules/claims/claim.routes.ts'
import type { ClaimService } from './modules/claims/claim.service.ts'
import type { BlogService } from './modules/blog/blog.service.ts'
import { commentRoutes } from './modules/comments/comment.routes.ts'
import type { CommentService } from './modules/comments/comment.service.ts'
import { feedbackRoutes } from './modules/feedback/feedback.routes.ts'
import type { FeedbackService } from './modules/feedback/feedback.service.ts'
import { entityRoutes } from './modules/entities/entity.routes.ts'
import type { EntityService } from './modules/entities/entity.service.ts'
import type { LiveToolsService } from './modules/entities/live-tools.ts'
import type { FieldService } from './modules/stats/field.service.ts'
import type { StatsService } from './modules/stats/stats.service.ts'
import type { TagService } from './modules/tags/tag.service.ts'
import { ROUTE_BY_KIND } from './modules/entities/presenters.ts'

/** 应用依赖：由 server.ts 装配真实实现，测试时可以注入假实现 */
export interface ApiDeps {
  /** 每种类型的业务服务；没提供的类型不挂接口 */
  entities: { [K in EntityKind]?: EntityService<K> }
  /** 远程服务工具列表的实时读取 */
  liveTools?: LiveToolsService
  /** 首页统计（各类型总数、近几天新增） */
  stats?: StatsService
  /** 首屏背景流动的名字 */
  field?: FieldService
  /** 标签页：全部标签及条目数 */
  tags?: TagService
  /** 评论；没有 auth 时只能读，写接口返回 503 */
  comments?: CommentService
  /** 详情页的问题反馈（不用登录，带了令牌时记下账号） */
  feedback?: FeedbackService
  /** 博客（已发布的文章） */
  blog?: BlogService
  /** MCP 服务认领；没配置 GitHub 应用时只能查状态 */
  claims?: ClaimService
  /** 认领用的 cookie 是否只走 HTTPS（站点地址是 https 时） */
  cookieSecure?: boolean
  /** Supabase 登录令牌校验 */
  auth?: AuthVerifier
  logger: Logger
  corsOrigins?: string[]
  /** 数据库连通性检查 */
  ping?: () => Promise<void>
}

export function createApp(deps: ApiDeps) {
  const app = new Hono()

  app.use('/api/*', cors({ origin: deps.corsOrigins ?? [], allowMethods: ['GET', 'POST', 'PUT', 'DELETE'] }))
  app.use('*', async (c, next) => {
    const started = Date.now()
    await next()
    deps.logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, 'request')
  })

  app.get('/api/health', async (c) => {
    await deps.ping?.()
    return c.json({ status: 'ok' })
  })
  // GET /api/servers/:slug/tools/live?locale —— 实时读取远程服务的 tools/list，描述有译文的换成请求语言
  const liveTools = deps.liveTools
  if (liveTools) {
    app.get('/api/servers/:slug/tools/live', async (c) => {
      const slug = c.req.param('slug')
      const result = await liveTools.get(slug, parseQuery(c, localeQuerySchema).locale)
      if (!result) throw ApiError.notFound(`MCP 服务 "${slug}" 不存在`)
      return c.json({ data: result })
    })
  }
  // GET /api/stats —— 首页统计：各类型总数、近 14 天每天新增、最近发布时间
  const stats = deps.stats
  if (stats) app.get('/api/stats', async (c) => c.json({ data: await stats.get() }))
  // GET /api/stats/field?locale —— 首屏背景里流动的名字（最热门的服务与 Skill，精简字段）
  const field = deps.field
  if (field) app.get('/api/stats/field', async (c) => c.json({ data: await field.get(parseQuery(c, localeQuerySchema).locale) }))
  // GET /api/tags?kind&q&letter&sort&page&pageSize —— 标签及条目数，附带标签总数、各类型和各首字母的标签数
  const tags = deps.tags
  if (tags) app.get('/api/tags', async (c) => c.json(await tags.list(parseQuery(c, tagsQuerySchema))))
  if (deps.comments) app.route('/api/comments', commentRoutes(deps.comments, deps.auth))
  if (deps.feedback) app.route('/api/feedback', feedbackRoutes(deps.feedback, deps.auth))
  if (deps.blog) app.route('/api/blog', blogRoutes(deps.blog))
  if (deps.claims) app.route('/api/claims', claimRoutes(deps.claims, deps.auth, { cookieSecure: deps.cookieSecure ?? true }))
  const services = Object.entries(deps.entities) as [EntityKind, EntityService<EntityKind>][]
  // GET /api/sitemap —— 各类型的条目总数；GET /api/sitemap/:kind?page&pageSize —— 分页列出 slug 与最后更新时间
  app.get('/api/sitemap', async (c) => {
    const data = await Promise.all(services.map(async ([kind, service]) => ({ kind, route: ROUTE_BY_KIND[kind], total: (await service.sitemap(1, 1)).meta.total })))
    return c.json({ data })
  })
  app.get('/api/sitemap/:kind', async (c) => {
    const entry = services.find(([kind]) => kind === c.req.param('kind'))
    if (!entry) throw ApiError.notFound(`类型 "${c.req.param('kind')}" 不存在`)
    const { page, pageSize } = parseQuery(c, sitemapQuerySchema)
    return c.json(await entry[1].sitemap(page, pageSize))
  })
  for (const [kind, service] of services) {
    app.route(`/api/${ROUTE_BY_KIND[kind]}`, entityRoutes(service))
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: `接口不存在：${c.req.method} ${c.req.path}` } }, 404))
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status)
    }
    deps.logger.error({ path: c.req.path, err: err.message }, '接口异常')
    return c.json({ error: { code: 'internal_error', message: '服务器内部错误' } }, 500)
  })

  return app
}
