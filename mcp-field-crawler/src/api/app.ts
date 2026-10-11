import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import { ApiError } from './http/errors.ts'
import { parseQuery, sitemapQuerySchema } from './http/query.ts'
import { entityRoutes } from './modules/entities/entity.routes.ts'
import type { EntityService } from './modules/entities/entity.service.ts'
import type { LiveToolsService } from './modules/entities/live-tools.ts'
import { ROUTE_BY_KIND } from './modules/entities/presenters.ts'

/** 应用依赖：由 server.ts 装配真实实现，测试时可以注入假实现 */
export interface ApiDeps {
  /** 每种类型的业务服务；没提供的类型不挂接口 */
  entities: { [K in EntityKind]?: EntityService<K> }
  /** 远程服务工具列表的实时读取 */
  liveTools?: LiveToolsService
  logger: Logger
  corsOrigins?: string[]
  /** 数据库连通性检查 */
  ping?: () => Promise<void>
}

export function createApp(deps: ApiDeps) {
  const app = new Hono()

  app.use('/api/*', cors({ origin: deps.corsOrigins ?? [], allowMethods: ['GET'] }))
  app.use('*', async (c, next) => {
    const started = Date.now()
    await next()
    deps.logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - started }, 'request')
  })

  app.get('/api/health', async (c) => {
    await deps.ping?.()
    return c.json({ status: 'ok' })
  })
  // GET /api/servers/:slug/tools/live —— 实时读取远程服务的 tools/list
  const liveTools = deps.liveTools
  if (liveTools) {
    app.get('/api/servers/:slug/tools/live', async (c) => {
      const slug = c.req.param('slug')
      const result = await liveTools.get(slug)
      if (!result) throw ApiError.notFound(`MCP 服务 "${slug}" 不存在`)
      return c.json({ data: result })
    })
  }
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
