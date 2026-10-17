import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import type { AssetStorage } from '../assets/storage.ts'
import { ApiError } from '../api/http/errors.ts'
import { BlogWriter, DIRECTIONS, resolveImages } from '../blog/generate.ts'
import { BlogImageMaker, type ImageSource } from '../blog/images.ts'
import { materialsText, searchMaterials, searchTerms } from '../blog/materials.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { blogPosts } from '../db/schema/index.ts'
import type { AdminUser } from './auth.ts'
import { imageReady, stockReady, textReady, type BlogAiSettings, type SettingsStore } from './settings.ts'

/*
 * 博客 AI 生成（挂在 /api/admin/blog/ai 下）：
 *   GET  /options    主题方向预设，以及文本模型、生图、图库是否已配置
 *   POST /summary    { title, body } → { summary }
 *   POST /body       { title, direction, keywords?, notes?, images } → 流式：正文增量、插图回填
 *   POST /cover      { title, summary, source } → 流式：封面地址
 *   POST /all        { direction, keywords, notes?, images, cover } → 流式：标题、地址、标签 → 正文 → 摘要 → 插图和封面
 * 流式接口返回 NDJSON（一行一个事件），每 10 秒发一次 ping，避免 Nginx / Cloudflare 在生图的几十秒里断开连接。
 * 模型服务读后台配置（admin_settings），写正文前按关键词在站内收录里找素材。
 */

type Env = { Variables: { user: AdminUser } }
type Emit = (event: Record<string, unknown>) => Promise<void>

const imagesSchema = z.object({ count: z.number().int().min(0).max(6).default(0), source: z.enum(['ai', 'stock']).default('ai') })
const direction = z.string().trim().min(1, '请选择或填写主题方向').max(300)

const bodySchema = z.object({
  title: z.string().trim().min(1, '先填写标题').max(200),
  direction,
  keywords: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2_000).optional(),
  images: imagesSchema.default({ count: 0, source: 'ai' }),
})
const allSchema = z.object({
  direction,
  keywords: z.string().trim().min(1, '请填写关键词').max(200),
  notes: z.string().trim().max(2_000).optional(),
  images: imagesSchema.default({ count: 2, source: 'ai' }),
  cover: z.enum(['ai', 'stock', 'none']).default('ai'),
})
const summarySchema = z.object({ title: z.string().trim().max(200).default(''), body: z.string().trim().min(50, '正文太短，先写一些内容再生成摘要').max(500_000) })
const coverSchema = z.object({ title: z.string().trim().min(1, '先填写标题').max(200), summary: z.string().trim().max(500).default(''), source: z.enum(['ai', 'stock']).default('ai') })

async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const result = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!result.success) throw ApiError.badRequest(result.error.issues[0]?.message ?? '请求内容不合法')
  return result.data
}

/** 地址已被占用时依次加 -2、-3… */
async function uniqueSlug(db: Db, slug: string): Promise<string> {
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? slug : `${slug}-${i}`
    const [row] = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.slug, candidate)).limit(1)
    if (!row) return candidate
  }
  return `${slug}-${Date.now().toString(36)}`
}

export function blogAiRoutes(deps: { db: Db; settings: SettingsStore; storage?: AssetStorage; logger: Logger }) {
  const app = new Hono<Env>()

  async function writer(): Promise<{ s: BlogAiSettings; writer: BlogWriter }> {
    const s = await deps.settings.blogAi()
    if (!textReady(s)) throw ApiError.badRequest('先在「AI 设置」里配置文本模型（baseURL、API Key、模型名）')
    return { s, writer: new BlogWriter(s.text) }
  }

  const imageMaker = (s: BlogAiSettings) =>
    deps.storage ? new BlogImageMaker(deps.storage, { image: imageReady(s) ? s.image : undefined, stockKey: stockReady(s) ? s.stock.apiKey : undefined }) : null

  /** 图片来源不可用时的原因（没配置 R2、没配置生图或图库） */
  const imageProblem = (maker: BlogImageMaker | null, source: ImageSource) =>
    !maker ? '服务器没有配置对象存储（R2），不能生成图片' : !maker.canMake(source) ? (source === 'ai' ? '没有配置生图模型' : '没有配置 Pexels 图库') : null

  /** NDJSON 流：ping 保活；客户端断开时中止进行中的模型请求 */
  function ndjson(c: Context<Env>, label: string, run: (emit: Emit, signal: AbortSignal) => Promise<void>) {
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    c.header('X-Accel-Buffering', 'no')
    const username = c.get('user').username
    return stream(c, async (s) => {
      const controller = new AbortController()
      s.onAbort(() => controller.abort())
      const emit: Emit = async (event) => {
        if (!s.aborted) await s.write(`${JSON.stringify(event)}\n`)
      }
      const ping = setInterval(() => void emit({ type: 'ping' }), 10_000)
      const started = Date.now()
      try {
        await run(emit, controller.signal)
        deps.logger.info({ username, label, seconds: Math.round((Date.now() - started) / 1000) }, '博客 AI 生成完成')
      } catch (error) {
        const message = controller.signal.aborted ? '已取消' : (error as Error).message
        deps.logger.warn({ username, label, err: message }, '博客 AI 生成失败')
        await emit({ type: 'error', message: error instanceof ApiError ? error.message : `生成失败：${message.slice(0, 300)}` })
      } finally {
        clearInterval(ping)
      }
    })
  }

  /** 写正文并回填插图；返回最终正文 */
  async function writeBody(emit: Emit, signal: AbortSignal, w: BlogWriter, maker: BlogImageMaker | null, input: Parameters<BlogWriter['body']>[0]): Promise<{ body: string; failed: string[] }> {
    await emit({ type: 'stage', stage: 'body', message: '正在写正文' })
    let body = ''
    for await (const delta of w.body(input, signal)) {
      body += delta
      await emit({ type: 'delta', text: delta })
    }
    body = body.trim()
    if (input.images.count === 0) return { body, failed: [] }
    await emit({ type: 'stage', stage: 'images', message: input.images.source === 'ai' ? '正在生成插图' : '正在从图库找插图' })
    const problem = imageProblem(maker, input.images.source)
    return resolveImages(
      body,
      (prompt, alt) => (problem ? Promise.reject(new Error(problem)) : maker!.make(input.images.source, prompt, alt, { signal })),
      (e) => void emit({ type: 'image', ...e }),
    )
  }

  async function makeCover(emit: Emit, signal: AbortSignal, w: BlogWriter, maker: BlogImageMaker | null, source: ImageSource, title: string, summary: string, prompt?: string): Promise<string | null> {
    const problem = imageProblem(maker, source)
    if (problem) {
      await emit({ type: 'warning', message: `封面没有生成：${problem}` })
      return null
    }
    await emit({ type: 'stage', stage: 'cover', message: source === 'ai' ? '正在生成封面' : '正在从图库找封面' })
    // 图库按英文搜索词找图：让模型先写一句英文描述，取其中的关键词
    const p = prompt || (await w.coverPrompt(title, summary, signal))
    const query = source === 'stock' ? p.split(/[\s,.]+/).filter((x) => x.length > 3).slice(0, 4).join(' ') : p
    const img = await maker!.make(source, query, title, { cover: true, signal })
    await emit({ type: 'cover', url: img.url })
    return img.url
  }

  app.get('/options', async (c) => {
    const s = await deps.settings.blogAi()
    return c.json({
      data: {
        directions: Object.entries(DIRECTIONS).map(([id, d]) => ({ id, label: d.label, guide: d.guide })),
        text: textReady(s),
        image: imageReady(s) && !!deps.storage,
        stock: stockReady(s) && !!deps.storage,
      },
    })
  })

  app.post('/summary', async (c) => {
    const input = await parse(c, summarySchema)
    const { writer: w } = await writer()
    const summary = await w.summary(input.title, input.body, c.req.raw.signal)
    deps.logger.info({ username: c.get('user').username, model: w.model }, '博客 AI 生成摘要')
    return c.json({ data: { summary } })
  })

  app.post('/body', async (c) => {
    const input = await parse(c, bodySchema)
    const { s, writer: w } = await writer()
    return ndjson(c, 'body', async (emit, signal) => {
      await emit({ type: 'stage', stage: 'materials', message: '正在站内找相关条目' })
      const items = await searchMaterials(deps.db, searchTerms(input.keywords, input.title))
      await emit({ type: 'materials', items: items.map((m) => ({ name: m.name, path: m.path })) })
      const { body, failed } = await writeBody(emit, signal, w, imageMaker(s), { ...input, materials: materialsText(items) })
      await emit({ type: 'body', body })
      await emit({ type: 'done', failed })
    })
  })

  app.post('/cover', async (c) => {
    const input = await parse(c, coverSchema)
    const { s, writer: w } = await writer()
    return ndjson(c, 'cover', async (emit, signal) => {
      const url = await makeCover(emit, signal, w, imageMaker(s), input.source, input.title, input.summary)
      await emit({ type: 'done', failed: url ? [] : ['封面'] })
    })
  })

  app.post('/all', async (c) => {
    const input = await parse(c, allSchema)
    const { s, writer: w } = await writer()
    return ndjson(c, 'all', async (emit, signal) => {
      const maker = imageMaker(s)
      await emit({ type: 'stage', stage: 'materials', message: '正在站内找相关条目' })
      const items = await searchMaterials(deps.db, searchTerms(input.keywords))
      await emit({ type: 'materials', items: items.map((m) => ({ name: m.name, path: m.path })) })
      const materials = materialsText(items)

      await emit({ type: 'stage', stage: 'plan', message: '正在拟定标题和提纲' })
      const plan = await w.plan({ direction: input.direction, keywords: input.keywords, notes: input.notes, materials }, signal)
      const slug = await uniqueSlug(deps.db, plan.slug)
      await emit({ type: 'meta', title: plan.title, slug, tags: plan.tags, outline: plan.outline })

      // 封面只依赖标题和规划里的提示词，和正文同时开始
      const cover = input.cover === 'none' ? Promise.resolve(null) : makeCover(emit, signal, w, maker, input.cover, plan.title, '', plan.coverPrompt).catch(async (error: unknown) => {
        await emit({ type: 'warning', message: `封面没有生成：${(error as Error).message}` })
        return null
      })
      const { body, failed } = await writeBody(emit, signal, w, maker, { title: plan.title, direction: input.direction, keywords: input.keywords, notes: input.notes, outline: plan.outline, materials, images: input.images })
      await emit({ type: 'body', body })

      await emit({ type: 'stage', stage: 'summary', message: '正在写摘要' })
      await emit({ type: 'summary', summary: await w.summary(plan.title, body, signal) })
      const coverUrl = await cover
      await emit({ type: 'done', failed: [...failed, ...(input.cover !== 'none' && !coverUrl ? ['封面'] : [])] })
    })
  })

  return app
}
