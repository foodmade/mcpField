import { createHash } from 'node:crypto'
import OpenAI from 'openai'
import sharp from 'sharp'
import type { AssetStorage } from '../assets/storage.ts'

/*
 * 博客图片：AI 生图（OpenAI 兼容的 images/generations）或 Pexels 图库，统一转成 WebP 后传到 R2（blog/ 下，按内容哈希命名）。
 * 封面裁成 16:9；正文插图只限制宽度。
 */

export type ImageSource = 'ai' | 'stock'

export interface BlogImage {
  url: string
}

export interface ImageConfig {
  image?: { baseURL: string; apiKey: string; model: string; size: string }
  stockKey?: string
}

/** 生图提示词统一加上风格要求：干净的科技插画、不要文字（生图模型写字常出错） */
const STYLE = 'Clean, modern editorial illustration for a developer-tools tech blog. Soft gradients, dark background with green and blue accents, minimal and abstract. No text, no letters, no logos, no watermarks.'

export class BlogImageMaker {
  constructor(
    private readonly storage: AssetStorage,
    private readonly config: ImageConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  canMake(source: ImageSource): boolean {
    return source === 'ai' ? !!this.config.image : !!this.config.stockKey
  }

  /** prompt：生图时是英文画面描述，图库时是英文搜索词 */
  async make(source: ImageSource, prompt: string, options: { cover?: boolean; signal?: AbortSignal } = {}): Promise<BlogImage> {
    const buffer = source === 'ai' ? await this.generate(prompt, options.signal) : await this.stock(prompt, options.signal)
    return { url: await this.upload(buffer, options.cover) }
  }

  private async generate(prompt: string, signal?: AbortSignal): Promise<Buffer> {
    const c = this.config.image
    if (!c) throw new Error('没有配置生图模型')
    const client = new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey, maxRetries: 1, timeout: 180_000 })
    const r = await client.images.generate({ model: c.model, prompt: `${prompt}\n\n${STYLE}`, size: c.size as '1536x1024', n: 1 }, { signal })
    const item = r.data?.[0]
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64')
    if (item?.url) return this.download(item.url, signal)
    throw new Error('生图接口没有返回图片')
  }

  /** Pexels 许可证不要求署名，图片下方不放摄影师信息 */
  private async stock(query: string, signal?: AbortSignal): Promise<Buffer> {
    if (!this.config.stockKey) throw new Error('没有配置 Pexels API Key')
    const res = await this.fetcher(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: '5', orientation: 'landscape' })}`, { headers: { Authorization: this.config.stockKey }, signal })
    if (!res.ok) throw new Error(`Pexels 搜索失败（${res.status}）`)
    const body = (await res.json()) as { photos?: { src: { large2x?: string; large?: string } }[] }
    const photo = body.photos?.[0]
    const src = photo?.src.large2x ?? photo?.src.large
    if (!src) throw new Error(`Pexels 没有找到“${query}”相关的照片`)
    return this.download(src, signal)
  }

  private async download(url: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.fetcher(url, { signal })
    if (!res.ok) throw new Error(`下载图片失败（${res.status}）`)
    return Buffer.from(await res.arrayBuffer())
  }

  /** 转成 WebP：封面裁成 1600×900，插图宽度不超过 1600 */
  private async upload(input: Buffer, cover?: boolean): Promise<string> {
    const image = sharp(input).rotate()
    const webp = await (cover ? image.resize(1600, 900, { fit: 'cover', position: 'attention' }) : image.resize({ width: 1600, withoutEnlargement: true })).webp({ quality: 82 }).toBuffer()
    const key = `blog/${createHash('sha256').update(webp).digest('hex').slice(0, 24)}.webp`
    if (!(await this.storage.exists(key))) await this.storage.put(key, webp, 'image/webp')
    return this.storage.publicUrl(key)
  }
}
