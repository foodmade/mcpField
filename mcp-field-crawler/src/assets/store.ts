import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { mediaAssets } from '../db/schema/index.ts'
import { sha256 } from '../store/hash.ts'
import type { ProcessedImage } from './processor.ts'

export type AssetStatus = 'pending' | 'ok' | 'failed' | 'skipped' | 'gone'

export interface AssetState {
  status: AssetStatus
  attempts: number
  nextRetryAt: Date | null
}

const CHUNK = 500

/** 按原始地址查转存后的地址：接口层只依赖这个接口 */
export interface AssetReader {
  lookup(sourceUrls: string[]): Promise<Map<string, string>>
}

/** 图片转存记录（media_assets 表）：只存链接和元信息 */
export class AssetStore implements AssetReader {
  constructor(private readonly db: Db) {}

  async states(urls: string[]): Promise<Map<string, AssetState>> {
    const out = new Map<string, AssetState>()
    for (let i = 0; i < urls.length; i += CHUNK) {
      const part = urls.slice(i, i + CHUNK)
      const byHash = new Map(part.map((u) => [sha256(u), u]))
      const rows = await this.db
        .select({ hash: mediaAssets.sourceUrlHash, status: mediaAssets.status, attempts: mediaAssets.attempts, nextRetryAt: mediaAssets.nextRetryAt })
        .from(mediaAssets)
        .where(inArray(mediaAssets.sourceUrlHash, [...byHash.keys()]))
      for (const r of rows) out.set(byHash.get(r.hash)!, { status: r.status as AssetStatus, attempts: r.attempts, nextRetryAt: r.nextRetryAt })
    }
    return out
  }

  /** 同样内容的图片已经存过：复用它的存储路径，不必重复上传 */
  async findByContent(contentHash: string): Promise<{ storageKey: string; publicUrl: string } | null> {
    const [row] = await this.db
      .select({ storageKey: mediaAssets.storageKey, publicUrl: mediaAssets.publicUrl })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.contentHash, contentHash), eq(mediaAssets.status, 'ok'), isNotNull(mediaAssets.storageKey)))
      .limit(1)
    return row?.storageKey && row.publicUrl ? { storageKey: row.storageKey, publicUrl: row.publicUrl } : null
  }

  async saveOk(sourceUrl: string, purpose: string, image: ProcessedImage, storageKey: string, publicUrl: string, attempts: number): Promise<void> {
    const values = {
      status: 'ok',
      storageKey,
      publicUrl,
      contentHash: image.contentHash,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: image.body.byteLength,
      originalMime: image.originalMime?.slice(0, 128) ?? null,
      originalBytes: image.originalBytes,
      httpStatus: 200,
      error: null,
      attempts,
      lastAttemptAt: new Date(),
      nextRetryAt: null,
    }
    await this.db
      .insert(mediaAssets)
      .values({ sourceUrl, sourceUrlHash: sha256(sourceUrl), purpose, ...values })
      .onDuplicateKeyUpdate({ set: values })
  }

  /** 失败：failed 按 1h、4h、16h……最长 7 天后重试；skipped / gone 不再自动重试 */
  async saveFailure(sourceUrl: string, purpose: string, status: Exclude<AssetStatus, 'ok' | 'pending'>, error: string, httpStatus: number | undefined, attempts: number): Promise<void> {
    const hours = Math.min(4 ** Math.max(0, attempts - 1), 168)
    const values = {
      status,
      error: error.slice(0, 512),
      httpStatus: httpStatus ?? null,
      attempts,
      lastAttemptAt: new Date(),
      nextRetryAt: status === 'failed' ? new Date(Date.now() + hours * 3_600_000) : null,
    }
    await this.db
      .insert(mediaAssets)
      .values({ sourceUrl, sourceUrlHash: sha256(sourceUrl), purpose, ...values })
      .onDuplicateKeyUpdate({ set: values })
  }

  /** 原图已失效的图片（不存在、不是图片），不再自动重试：图标补全时换成所有者头像 */
  async brokenUrls(): Promise<Set<string>> {
    const rows = await this.db.select({ url: mediaAssets.sourceUrl }).from(mediaAssets).where(inArray(mediaAssets.status, ['gone', 'skipped']))
    return new Set(rows.map((r) => r.url))
  }

  async lookup(sourceUrls: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const unique = [...new Set(sourceUrls)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const part = unique.slice(i, i + CHUNK)
      const byHash = new Map(part.map((u) => [sha256(u), u]))
      const rows = await this.db
        .select({ hash: mediaAssets.sourceUrlHash, publicUrl: mediaAssets.publicUrl })
        .from(mediaAssets)
        .where(and(inArray(mediaAssets.sourceUrlHash, [...byHash.keys()]), eq(mediaAssets.status, 'ok')))
      for (const r of rows) if (r.publicUrl) out.set(byHash.get(r.hash)!, r.publicUrl)
    }
    return out
  }
}
