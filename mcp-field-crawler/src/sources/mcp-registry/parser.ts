import { ParseError } from '../../core/errors.ts'
import type { Parser } from '../../core/source.ts'
import type { CrawlTarget, RawDocument, SourceRecord } from '../../core/types.ts'
import { entrySchema, type RegistryEntry } from './schema.ts'

/** { server, _meta } → 源记录；整条保留（都是发布者公开的元数据） */
export class RegistryServerParser implements Parser<RegistryEntry> {
  readonly version = 1

  async parse(doc: RawDocument, target: CrawlTarget): Promise<SourceRecord<RegistryEntry>[]> {
    let json: unknown
    try {
      json = JSON.parse(doc.body)
    } catch (error) {
      throw new ParseError(target.url, '不是合法的 JSON', { cause: error })
    }
    const result = entrySchema.safeParse(json)
    if (!result.success) throw new ParseError(target.url, `数据结构不符合预期：${result.error.message}`)
    return [
      {
        sourceId: target.sourceId,
        kind: 'server',
        externalId: target.externalId,
        url: doc.url,
        parserVersion: this.version,
        fetchedAt: doc.fetchedAt,
        data: result.data,
      },
    ]
  }
}
