import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import OpenAI from 'openai'
import { z } from 'zod'
import { ApiError } from '../api/http/errors.ts'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { adminSettings } from '../db/schema/index.ts'
import type { AdminUser } from './auth.ts'

/*
 * 后台可修改的博客 AI 配置（admin_settings 表 blog-ai 一行）：
 *   text   文本模型：写摘要、正文、起标题和标签（OpenAI 兼容的 chat/completions 接口）
 *   image  生图模型：封面和正文插图（OpenAI 兼容的 images/generations 接口，如 gpt-image-1）
 *   stock  Pexels 图库：正文插图也可以从图库搜现成照片
 * 接口（挂在 /api/admin/settings 下）：
 *   GET  /blog-ai          读配置，API Key 只回显掩码
 *   PUT  /blog-ai          保存；apiKey 不传表示不改，传空字符串表示清除
 *   POST /blog-ai/test     测试连接 { target: text | image | stock }
 */

export interface ModelEndpoint {
  baseURL: string
  apiKey: string
  model: string
}

export interface BlogAiSettings {
  text: ModelEndpoint
  image: ModelEndpoint & { size: string }
  stock: { apiKey: string }
}

const KEY = 'blog-ai'

export const IMAGE_SIZES = ['1536x1024', '1024x1024', '1792x1024'] as const

const DEFAULTS: BlogAiSettings = {
  text: { baseURL: '', apiKey: '', model: '' },
  image: { baseURL: '', apiKey: '', model: 'gpt-image-1', size: '1536x1024' },
  stock: { apiKey: '' },
}

/** sk-abc…wxyz：只露头尾几位，让人认得出是哪个 Key */
export const maskKey = (key: string) => (!key ? '' : key.length <= 10 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`)

export const textReady = (s: BlogAiSettings) => !!(s.text.baseURL && s.text.apiKey && s.text.model)
export const imageReady = (s: BlogAiSettings) => !!(s.image.baseURL && s.image.apiKey && s.image.model)
export const stockReady = (s: BlogAiSettings) => !!s.stock.apiKey

export class SettingsStore {
  constructor(private readonly db: Db) {}

  async blogAi(): Promise<BlogAiSettings> {
    const [row] = await this.db.select({ value: adminSettings.value }).from(adminSettings).where(eq(adminSettings.key, KEY)).limit(1)
    const v = (typeof row?.value === 'string' ? JSON.parse(row.value) : (row?.value ?? {})) as Partial<BlogAiSettings>
    return { text: { ...DEFAULTS.text, ...v.text }, image: { ...DEFAULTS.image, ...v.image }, stock: { ...DEFAULTS.stock, ...v.stock } }
  }

  async saveBlogAi(value: BlogAiSettings, username: string): Promise<void> {
    await this.db
      .insert(adminSettings)
      .values({ key: KEY, value, updatedBy: username })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: username } })
  }
}

/** 去掉末尾斜杠；只接受 http(s) 地址 */
const baseUrl = z
  .string()
  .trim()
  .max(300)
  .transform((v) => v.replace(/\/+$/, ''))
  .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), 'baseURL 要以 http:// 或 https:// 开头')
const apiKey = z.string().trim().max(500).optional()
const model = z.string().trim().max(100)

const saveSchema = z.object({
  text: z.object({ baseURL: baseUrl, apiKey, model }),
  image: z.object({ baseURL: baseUrl, apiKey, model, size: z.enum(IMAGE_SIZES) }),
  stock: z.object({ apiKey }),
})

function masked(s: BlogAiSettings) {
  return {
    text: { ...s.text, apiKey: maskKey(s.text.apiKey), hasKey: !!s.text.apiKey, ready: textReady(s) },
    image: { ...s.image, apiKey: maskKey(s.image.apiKey), hasKey: !!s.image.apiKey, ready: imageReady(s) },
    stock: { apiKey: maskKey(s.stock.apiKey), hasKey: !!s.stock.apiKey, ready: stockReady(s) },
  }
}

const client = (e: ModelEndpoint) => new OpenAI({ baseURL: e.baseURL, apiKey: e.apiKey, maxRetries: 0, timeout: 30_000 })

/** 测试连接：文本模型发一句话；生图模型只读模型列表（真生成一张图要花钱、要几十秒）；Pexels 搜一张图 */
async function test(target: 'text' | 'image' | 'stock', s: BlogAiSettings): Promise<string> {
  if (target === 'text') {
    if (!textReady(s)) throw ApiError.badRequest('先填好文本模型的 baseURL、API Key 和模型名')
    const started = Date.now()
    const r = await client(s.text).chat.completions.create({ model: s.text.model, messages: [{ role: 'user', content: '只回复 OK 两个字母' }], max_completion_tokens: 200 })
    return `连接正常（${Date.now() - started} ms）：${(r.choices[0]?.message.content ?? '').trim().slice(0, 40) || '模型返回了空内容'}`
  }
  if (target === 'image') {
    if (!imageReady(s)) throw ApiError.badRequest('先填好生图模型的 baseURL、API Key 和模型名')
    try {
      const list = await client(s.image).models.list()
      const ids = list.data.map((m) => m.id)
      return ids.includes(s.image.model) ? `连接正常，模型列表里有 ${s.image.model}` : `连接正常，但模型列表里没有 ${s.image.model}（有的服务不列出生图模型，可以直接生成一张试试）`
    } catch (error) {
      const status = (error as { status?: number }).status
      // 有的代理不提供模型列表：401/403 说明 Key 不对，404 说明只是没有这个接口
      if (status === 404) return '连接正常，但服务没有提供模型列表，生图要在实际生成时验证'
      throw error
    }
  }
  if (!stockReady(s)) throw ApiError.badRequest('先填好 Pexels 的 API Key')
  const res = await fetch('https://api.pexels.com/v1/search?query=code&per_page=1', { headers: { Authorization: s.stock.apiKey }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new ApiError(400, 'stock_failed', `Pexels 返回 ${res.status}${res.status === 401 ? '：API Key 不对' : ''}`)
  const body = (await res.json()) as { total_results?: number }
  return `连接正常，Pexels 搜索可用（示例搜索有 ${body.total_results ?? 0} 张图）`
}

export function settingsRoutes(deps: { store: SettingsStore; logger: Logger }) {
  const app = new Hono<{ Variables: { user: AdminUser } }>()

  app.get('/blog-ai', async (c) => c.json({ data: masked(await deps.store.blogAi()) }))

  app.put('/blog-ai', async (c) => {
    const result = saveSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!result.success) throw ApiError.badRequest(result.error.issues[0]?.message ?? '请求内容不合法')
    const input = result.data
    const current = await deps.store.blogAi()
    // apiKey 没传：沿用原来的；传了（包括空字符串）：替换
    const next: BlogAiSettings = {
      text: { baseURL: input.text.baseURL, model: input.text.model, apiKey: input.text.apiKey ?? current.text.apiKey },
      image: { baseURL: input.image.baseURL, model: input.image.model, size: input.image.size, apiKey: input.image.apiKey ?? current.image.apiKey },
      stock: { apiKey: input.stock.apiKey ?? current.stock.apiKey },
    }
    await deps.store.saveBlogAi(next, c.get('user').username)
    deps.logger.info({ username: c.get('user').username, text: next.text.baseURL && `${next.text.baseURL} ${next.text.model}`, image: next.image.baseURL && `${next.image.baseURL} ${next.image.model}`, stock: !!next.stock.apiKey }, '保存博客 AI 配置')
    return c.json({ data: masked(next) })
  })

  app.post('/blog-ai/test', async (c) => {
    const result = z.object({ target: z.enum(['text', 'image', 'stock']) }).safeParse(await c.req.json().catch(() => ({})))
    if (!result.success) throw ApiError.badRequest('请求内容不合法')
    try {
      return c.json({ data: { ok: true, message: await test(result.data.target, await deps.store.blogAi()) } })
    } catch (error) {
      if (error instanceof ApiError) throw error
      const e = error as { status?: number; message?: string }
      return c.json({ data: { ok: false, message: `连接失败${e.status ? `（${e.status}）` : ''}：${(e.message ?? '').slice(0, 200)}` } })
    }
  })

  return app
}
