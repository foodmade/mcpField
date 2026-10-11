import { createHash } from 'node:crypto'
import sharp, { type Sharp } from 'sharp'
import { assertPublicHttps, BlockedTargetError } from '../probe/mcp-remote.ts'

/*
 * 下载第三方图片并统一处理成 WebP。
 * 图片地址来自收录数据，属于第三方输入：只允许 https、拒绝内网地址、
 * 手动跟随重定向（每一跳都重新校验）、限制大小和超时；SVG 转成位图后再存，避免从我们的域名提供可执行脚本的 SVG。
 */

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 15_000
const ICON_SIZE = 256

export type FetchFailure = { kind: 'gone' | 'blocked' | 'failed' | 'unsupported'; status?: number; message: string }

export class AssetError extends Error {
  constructor(readonly failure: FetchFailure) {
    super(failure.message)
    this.name = 'AssetError'
  }
}

export interface ProcessedImage {
  body: Buffer
  contentHash: string
  mime: 'image/webp'
  width: number
  height: number
  originalMime: string | null
  originalBytes: number
}

/**
 * 下载前调整地址：
 * - GitHub 头像直接请求 256px 版本，省流量（github.com/<login>.png 跳转后也会保留 size 参数）；
 * - github.com 上的文件页面（/blob/、/raw/）换成 raw.githubusercontent.com 的原始文件地址，
 *   否则拿到的是网页而不是图片（github.com 在部分网络下也连不上）。
 */
export function downloadUrl(source: string): string {
  try {
    const url = new URL(source)
    if (url.hostname === 'avatars.githubusercontent.com') {
      url.searchParams.set('s', String(ICON_SIZE))
      return url.toString()
    }
    if (url.hostname === 'github.com' && /^\/[A-Za-z0-9-]+\.png$/.test(url.pathname)) {
      url.searchParams.set('size', String(ICON_SIZE))
      return url.toString()
    }
    const file = url.hostname === 'github.com' ? /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname) : null
    if (file) return `https://raw.githubusercontent.com/${file[1]}/${file[2]}/${file[3]}`
    return source
  } catch {
    return source
  }
}

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BYTES) throw new AssetError({ kind: 'unsupported', message: `文件过大：${declared} 字节` })
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new AssetError({ kind: 'unsupported', message: `文件超过 ${MAX_BYTES} 字节` })
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** 下载原图：手动跟随重定向，每一跳都校验目标地址 */
export async function download(source: string, userAgent: string): Promise<{ body: Buffer; mime: string | null }> {
  let current = downloadUrl(source)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      await assertPublicHttps(current)
    } catch (error) {
      if (error instanceof BlockedTargetError) throw new AssetError({ kind: 'blocked', message: error.message })
      throw new AssetError({ kind: 'failed', message: `域名解析失败：${(error as Error).message}` })
    }
    let res: Response
    try {
      res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': userAgent, accept: 'image/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new AssetError({ kind: 'failed', message: `下载失败：${(error as Error).message}` })
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      await res.body?.cancel()
      if (!location) throw new AssetError({ kind: 'failed', status: res.status, message: '重定向缺少目标地址' })
      current = new URL(location, current).toString()
      continue
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel()
      throw new AssetError({ kind: 'gone', status: res.status, message: `原图不存在（HTTP ${res.status}）` })
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw new AssetError({ kind: 'failed', status: res.status, message: `HTTP ${res.status}` })
    }
    const mime = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null
    if (mime && (mime.startsWith('text/html') || mime === 'application/json')) {
      await res.body?.cancel()
      throw new AssetError({ kind: 'unsupported', status: res.status, message: `不是图片：${mime}` })
    }
    return { body: await readLimited(res), mime }
  }
  throw new AssetError({ kind: 'failed', message: '重定向次数过多' })
}

/** 统一处理：按方向旋转、缩放到 256×256 以内（不放大）、输出 WebP；SVG 先按高分辨率转成位图 */
export async function toWebp(input: Buffer, originalMime: string | null): Promise<ProcessedImage> {
  const isSvg = originalMime === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(input.subarray(0, 512).toString('utf8'))
  let pipeline: Sharp
  try {
    pipeline = sharp(input, { density: isSvg ? 300 : 72, animated: false, limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize(ICON_SIZE, ICON_SIZE, { fit: 'inside', withoutEnlargement: !isSvg })
      .webp({ quality: 86, alphaQuality: 90, effort: 5 })
  } catch (error) {
    throw new AssetError({ kind: 'unsupported', message: `无法读取图片：${(error as Error).message}` })
  }
  try {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    return {
      body: data,
      contentHash: createHash('sha256').update(data).digest('hex'),
      mime: 'image/webp',
      width: info.width,
      height: info.height,
      originalMime,
      originalBytes: input.byteLength,
    }
  } catch (error) {
    throw new AssetError({ kind: 'unsupported', message: `无法处理图片：${(error as Error).message.slice(0, 200)}` })
  }
}

/** 存储路径：icons/ab/ab12…ef.webp（按哈希前两位分目录） */
export const storageKey = (purpose: string, contentHash: string) => `${purpose}s/${contentHash.slice(0, 2)}/${contentHash}.webp`
