import { Hono } from 'hono'
import type { EntityKind } from '../../../core/types.ts'
import { ApiError } from '../../http/errors.ts'
import { listQuerySchema, localeQuerySchema, parseQuery, scopeQuerySchema } from '../../http/query.ts'
import type { EntityService } from './entity.service.ts'
import { LABEL_BY_KIND } from './presenters.ts'

/**
 * 每种类型同一组接口（挂在 /api/<servers|clients|cli|skills|loops|agents> 下）：
 * GET /              列表：page, pageSize, q, category, featured, verified, official, remote, type, sort, locale
 * GET /facets        目录侧栏计数：总数、官方/精选/已认证、各子类型、各分类；remote 限定范围
 * GET /categories    分类汇总（含源站原始分类的对应关系）
 * GET /:slug         详情：locale
 */
export function entityRoutes<K extends EntityKind>(service: EntityService<K>) {
  return new Hono()
    .get('/', async (c) => c.json(await service.list(parseQuery(c, listQuerySchema))))
    .get('/facets', async (c) => c.json(await service.facets(parseQuery(c, scopeQuerySchema))))
    .get('/categories', async (c) => c.json(await service.categories(parseQuery(c, scopeQuerySchema))))
    .get('/:slug', async (c) => {
      const slug = c.req.param('slug')
      const { locale } = parseQuery(c, localeQuerySchema)
      const entity = await service.get(slug, locale)
      if (!entity) throw ApiError.notFound(`${LABEL_BY_KIND[service.kind]} "${slug}" 不存在`)
      return c.json({ data: entity })
    })
}
