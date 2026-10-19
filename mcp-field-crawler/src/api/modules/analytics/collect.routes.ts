import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AnalyticsCollector } from '../../../analytics/collector.ts'

/*
 * POST /api/collect —— 网站前端每打开一个页面（包括站内跳转）用 sendBeacon 发一条：{ p: 路径, r?: 来源页面, e?: 是否是打开网站的第一个页面 }。
 * 只进内存队列、立即返回 204；不合法的请求和爬虫也返回 204（前端不处理结果，也不给刷数据的人提示）。
 * 访客 IP 取 Cloudflare 的 CF-Connecting-IP（经 Nginx 和前端服务原样转发），只用来算当天的访客标识，不落库。
 */

const bodySchema = z.object({
  p: z.string().min(1).max(1024),
  r: z.string().max(2048).optional(),
  e: z.boolean().optional(),
})

export function collectRoutes(collector: AnalyticsCollector) {
  return new Hono()
    .use('*', bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.body(null, 413) }))
    .post('/', async (c) => {
      let raw: unknown = null
      try {
        // sendBeacon 发的可能是 text/plain，按文本读再解析
        raw = JSON.parse(await c.req.text())
      } catch {
        /* 不是 JSON，忽略 */
      }
      const parsed = bodySchema.safeParse(raw)
      if (parsed.success) {
        await collector.record({
          path: parsed.data.p,
          referrer: parsed.data.r,
          entry: parsed.data.e ?? false,
          ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? null,
          ua: c.req.header('user-agent') ?? '',
          country: c.req.header('cf-ipcountry'),
        })
      }
      c.header('Cache-Control', 'no-store')
      return c.body(null, 204)
    })
}
