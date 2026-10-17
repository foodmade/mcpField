import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { BLOG_SLUG_RE } from '../../../blog/post.ts'
import { ApiError } from '../../http/errors.ts'
import { LOCALES } from '../../../core/types.ts'
import { parseQuery } from '../../http/query.ts'
import type { BlogService } from './blog.service.ts'

/** 文章原文是中文：不传语言时默认中文（条目接口默认英文，这里不同） */
const localeSchema = z.object({ locale: z.enum(LOCALES).default('zh') })

const listSchema = z.object({
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
  locale: localeSchema.shape.locale,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

const slugOf = (c: Context): string => {
  const slug = c.req.param('slug') ?? ''
  if (!BLOG_SLUG_RE.test(slug) || slug.length > 120) throw ApiError.notFound('文章不存在')
  return slug
}

/**
 * 博客接口（挂在 /api/blog 下），只返回已发布且发布时间已到的文章。locale 是请求语言（默认 zh）：
 * 有这种语言的译文时标题、摘要、正文换成译文，没有时用中文原文（返回的 locale 字段标明实际语言）。
 * GET  /posts?tag&q&locale&page&pageSize            列表，附带不受筛选影响的汇总（置顶、常用标签）
 * GET  /posts/:slug?locale                          全文（Markdown）+ 上一篇 / 下一篇 + 相关文章
 * GET  /all?locale                                  全部文章（不带正文），sitemap 和 RSS 用
 */
export function blogRoutes(service: BlogService) {
  const app = new Hono()

  app.get('/posts', async (c) => c.json(await service.list(parseQuery(c, listSchema))))

  app.get('/posts/:slug', async (c) => {
    const post = await service.get(slugOf(c), parseQuery(c, localeSchema).locale)
    if (!post) throw ApiError.notFound('文章不存在')
    return c.json({ data: post })
  })

  app.get('/all', async (c) => c.json({ data: await service.all(parseQuery(c, localeSchema).locale) }))

  return app
}
