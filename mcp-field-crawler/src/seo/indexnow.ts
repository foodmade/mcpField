import { and, gte, inArray } from 'drizzle-orm'
import { ROUTE_BY_KIND } from '../api/modules/entities/presenters.ts'
import type { Logger } from '../core/logger.ts'
import { LOCALES, type EntityKind, type Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestPublished } from '../db/schema/index.ts'

/*
 * IndexNow：页面内容变了就通知 Bing、Yandex、Naver、Seznam 等搜索引擎（Google 不支持），不用等它们来抓 sitemap。
 * 只推内容真的变了的条目（content_changed_at 不早于本次发布开始，见 merge/publish.ts contentHash），每个条目推三种语言的地址。
 * 搜索引擎从 <站点>/<密钥>.txt 读到同一个密钥才认（文件在 mcp-field/public 下）。
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
/** 协议规定单次请求最多 1 万个地址 */
export const INDEXNOW_BATCH = 10_000

/** 网站地址的语言前缀，与 mcp-field 的 withLocale 一致：中文没有前缀 */
const LOCALE_PREFIX: Record<Locale, string> = { zh: '', en: '/en', ja: '/ja' }
/** 能直接放进 URL 路径的 slug，与 sitemap 的规则一致；个别源站数据把网址当成了 slug，这类不推 */
const SAFE_SLUG = /^[A-Za-z0-9._~-]+$/

export interface IndexNowConfig {
  key: string
  /** 网站地址，如 https://mcpfield.com */
  siteUrl: string
}

/** 一个条目三种语言的详情页地址 */
export function entryUrls(siteUrl: string, kind: EntityKind, slug: string): string[] {
  if (!SAFE_SLUG.test(slug)) return []
  return LOCALES.map((l) => `${siteUrl}${LOCALE_PREFIX[l]}/${ROUTE_BY_KIND[kind]}/${slug}`)
}

/** 内容在 since 之后变化过的条目的地址 */
export async function changedUrls(db: Db, siteUrl: string, kinds: readonly EntityKind[], since: Date): Promise<string[]> {
  const rows = await db
    .select({ kind: ingestPublished.kind, slug: ingestPublished.slug })
    .from(ingestPublished)
    .where(and(inArray(ingestPublished.kind, [...kinds]), gte(ingestPublished.contentChangedAt, since)))
  return rows.flatMap((r) => entryUrls(siteUrl, r.kind as EntityKind, r.slug))
}

/** 分批提交；200（已收到）和 202（已收到、密钥待验证）都算成功，其余抛错 */
export async function submitUrls(urls: string[], config: IndexNowConfig, fetchFn: typeof fetch = fetch): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < urls.length; i += INDEXNOW_BATCH) {
    const res = await fetchFn(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(config.siteUrl).host, key: config.key, keyLocation: `${config.siteUrl}/${config.key}.txt`, urlList: urls.slice(i, i + INDEXNOW_BATCH) }),
    })
    if (!res.ok) throw new Error(`IndexNow 返回 ${res.status}：${(await res.text()).slice(0, 200)}`)
    statuses.push(res.status)
  }
  return statuses
}

/** 推送 since 之后内容变化的条目；没有变化时不发请求。返回推送的地址数 */
export async function pushChanged(db: Db, config: IndexNowConfig, kinds: readonly EntityKind[], since: Date, logger: Logger): Promise<number> {
  const urls = await changedUrls(db, config.siteUrl, kinds, since)
  if (urls.length === 0) {
    logger.info({ since: since.toISOString() }, 'IndexNow：没有内容变化的条目')
    return 0
  }
  const statuses = await submitUrls(urls, config)
  logger.info({ urls: urls.length, requests: statuses.length, statuses: [...new Set(statuses)] }, 'IndexNow 推送完成')
  return urls.length
}
