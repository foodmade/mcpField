import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { BLOG_CATEGORIES, BLOG_SLUG_RE } from '../../../blog/post.ts'
import { ApiError } from '../../http/errors.ts'
import { parseQuery } from '../../http/query.ts'
import type { BlogService } from './blog.service.ts'

const listSchema = z.object({
  category: z.enum(BLOG_CATEGORIES).optional(),
  tag: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .optional()
    .transform((v) => v || undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

const slugOf = (c: Context): string => {
  const slug = c.req.param('slug') ?? ''
  if (!BLOG_SLUG_RE.test(slug) || slug.length > 120) throw ApiError.notFound('文章不存在')
  return slug
}

/**
 * 博客接口（挂在 /api/blog 下），只返回已发布且发布时间已到的文章：
 * GET  /posts?category&tag&q&page&pageSize   列表，附带不受筛选影响的汇总（栏目计数、置顶、热门、常用标签）
 * GET  /posts/:slug                          全文（Markdown）+ 上一篇 / 下一篇 + 相关文章
 * GET  /all                                  全部文章（不带正文），sitemap 和 RSS 用
 * POST /posts/:slug/views                    浏览数 +1（浏览器里打开文章时发）
 */
export function blogRoutes(service: BlogService) {
  const app = new Hono()

  app.get('/posts', async (c) => c.json(await service.list(parseQuery(c, listSchema))))

  app.get('/posts/:slug', async (c) => {
    const post = await service.get(slugOf(c))
    if (!post) throw ApiError.notFound('文章不存在')
    return c.json({ data: post })
  })

  app.get('/all', async (c) => c.json({ data: await service.all() }))

  app.post('/posts/:slug/views', async (c) => {
    await service.addView(slugOf(c))
    return c.body(null, 204)
  })

  return app
}
