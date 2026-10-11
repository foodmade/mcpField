import { ParseError } from '../../core/errors.ts'
import type { Parser } from '../../core/source.ts'
import type { CrawlTarget, EntityKind, RawDocument, SourceRecord } from '../../core/types.ts'
import { loadHtml } from '../../extract/html.ts'
import { extractTanStackMatches, findLoaderValue } from '../../extract/tanstack.ts'
import { LOADER_KEY, SCHEMA_BY_KIND, type McpSoData } from './schema.ts'

/**
 * 解析时直接丢弃的字段：
 * - mcp.so 用户的个人数据（提交者、所有者账号）
 * - mcp.so 自己撰写的长篇介绍（我们不发布它的原创内容，也没必要占用存储）
 */
const DROPPED_FIELDS = ['submittedBy', 'ownerId', 'overviewMd', 'overviewSourceHash', 'content', 'lastSyncError', 'paidSubmission']

export class McpSoDetailParser implements Parser<McpSoData> {
  readonly version = 1

  constructor(private readonly kind: EntityKind) {}

  async parse(doc: RawDocument, target: CrawlTarget): Promise<SourceRecord<McpSoData>[]> {
    let matches
    try {
      matches = await extractTanStackMatches(loadHtml(doc.body))
    } catch (error) {
      throw new ParseError(target.url, '页面内嵌数据无法执行', { cause: error })
    }
    const raw = findLoaderValue(matches, LOADER_KEY[this.kind])
    if (!raw) throw new ParseError(target.url, `页面里没有找到 "${LOADER_KEY[this.kind]}" 数据`)

    const result = SCHEMA_BY_KIND[this.kind].safeParse(raw)
    if (!result.success) throw new ParseError(target.url, `数据结构不符合预期：${result.error.message}`)

    const item = { ...result.data } as Record<string, unknown>
    for (const field of DROPPED_FIELDS) delete item[field]

    const context: McpSoData['context'] = {}
    const categoryName = findLoaderValue(matches, 'categoryName')
    const categorySlug = findLoaderValue(matches, 'categorySlug')
    const linkableTags = findLoaderValue(matches, 'linkableTags')
    if (typeof categoryName === 'string') context.categoryName = categoryName
    if (typeof categorySlug === 'string') context.categorySlug = categorySlug
    if (Array.isArray(linkableTags)) context.linkableTags = linkableTags.filter((t) => typeof t === 'string')

    return [
      {
        sourceId: target.sourceId,
        kind: this.kind,
        externalId: target.externalId,
        url: doc.url,
        parserVersion: this.version,
        fetchedAt: doc.fetchedAt,
        data: { item: item as McpSoData['item'], context },
      },
    ]
  }
}
