import { sql } from 'drizzle-orm'
import pLimit from 'p-limit'
import type { MediaType } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { AssetError, download, storageKey, toWebp, type ProcessedImage } from './processor.ts'
import type { AssetStorage } from './storage.ts'
import type { AssetState, AssetStore } from './store.ts'

/** 从草稿里收集要转存的图片地址（去重） */
export async function collectMediaUrls(db: Db, kinds: readonly EntityKind[], types: readonly MediaType[]): Promise<{ url: string; type: MediaType }[]> {
  const [rows] = (await db.execute(sql`
    SELECT DISTINCT m.url, m.type
    FROM ingest_drafts d,
         JSON_TABLE(d.draft, '$.media[*]' COLUMNS (type VARCHAR(16) PATH '$.type', url VARCHAR(2048) PATH '$.url')) m
    WHERE d.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
      AND m.type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})`)) as unknown as [{ url: string; type: MediaType }[]]
  const seen = new Set<string>()
  return rows.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url))
}

export interface MirrorOptions {
  concurrency: number
  limit?: number
  /** 已转存的也重新处理 */
  force?: boolean
  /** 不支持的格式、原图不存在的也重试 */
  retryAll?: boolean
  signal?: AbortSignal
}

export interface MirrorStats {
  total: number
  pending: number
  ok: number
  reused: number
  failed: number
  skipped: number
  gone: number
  uploadedBytes: number
  seconds: number
}

type Store = Pick<AssetStore, 'states' | 'findByContent' | 'saveOk' | 'saveFailure'>

function due(state: AssetState | undefined, options: MirrorOptions): boolean {
  if (!state || options.force) return true
  if (state.status === 'ok') return false
  if (state.status === 'skipped' || state.status === 'gone') return !!options.retryAll
  return options.retryAll || !state.nextRetryAt || state.nextRetryAt.getTime() <= Date.now()
}

/**
 * 图片转存：跳过已完成的 → 并发下载并转成 WebP → 按内容哈希上传（同样内容只传一次）→ 记录链接。
 * 下载器和处理器可注入，便于测试。
 */
export class AssetMirror {
  constructor(
    private readonly storage: AssetStorage,
    private readonly store: Store,
    private readonly logger: Logger,
    private readonly userAgent: string,
    private readonly fetchImage: (url: string, userAgent: string) => Promise<{ body: Buffer; mime: string | null }> = download,
    private readonly process: (body: Buffer, mime: string | null) => Promise<ProcessedImage> = toWebp,
  ) {}

  async run(items: { url: string; type: MediaType }[], options: MirrorOptions): Promise<MirrorStats> {
    const started = Date.now()
    const states = await this.store.states(items.map((i) => i.url))
    let pending = items.filter((i) => due(states.get(i.url), options))
    if (options.limit !== undefined) pending = pending.slice(0, options.limit)
    const stats: MirrorStats = { total: items.length, pending: pending.length, ok: 0, reused: 0, failed: 0, skipped: 0, gone: 0, uploadedBytes: 0, seconds: 0 }
    this.logger.info({ total: items.length, done: items.length - pending.length, pending: pending.length, storage: this.storage.name }, '开始转存图片')

    const limit = pLimit(options.concurrency)
    let finished = 0
    await Promise.all(
      pending.map((item) =>
        limit(async () => {
          if (options.signal?.aborted) return
          const attempts = (states.get(item.url)?.attempts ?? 0) + 1
          try {
            const original = await this.fetchImage(item.url, this.userAgent)
            const image = await this.process(original.body, original.mime)
            const key = storageKey(item.type, image.contentHash)
            const existing = await this.store.findByContent(image.contentHash)
            if (existing) {
              await this.store.saveOk(item.url, item.type, image, existing.storageKey, existing.publicUrl, attempts)
              stats.reused++
            } else {
              if (!(await this.storage.exists(key))) {
                await this.storage.put(key, image.body, image.mime)
                stats.uploadedBytes += image.body.byteLength
              }
              await this.store.saveOk(item.url, item.type, image, key, this.storage.publicUrl(key), attempts)
            }
            stats.ok++
          } catch (error) {
            const failure = error instanceof AssetError ? error.failure : { kind: 'failed' as const, message: (error as Error).message }
            const status = failure.kind === 'gone' ? 'gone' : failure.kind === 'unsupported' || failure.kind === 'blocked' ? 'skipped' : 'failed'
            stats[status]++
            await this.store.saveFailure(item.url, item.type, status, failure.message, failure.status, attempts)
            this.logger.debug({ url: item.url, status, err: failure.message }, '图片转存失败')
          }
          finished++
          if (finished % 200 === 0 || finished === pending.length) {
            this.logger.info({ progress: `${finished}/${pending.length}`, ok: stats.ok, reused: stats.reused, failed: stats.failed, skipped: stats.skipped, gone: stats.gone }, '转存进度')
          }
        }),
      ),
    )
    stats.seconds = Math.round((Date.now() - started) / 1000)
    return stats
  }
}
