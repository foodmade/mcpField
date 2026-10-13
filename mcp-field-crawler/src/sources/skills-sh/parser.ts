import { ParseError } from '../../core/errors.ts'
import type { Parser } from '../../core/source.ts'
import type { CrawlTarget, RawDocument, SourceRecord } from '../../core/types.ts'
import { documentSchema, type SkillsShRecord } from './schema.ts'

/** SKILL.md：优先技能目录根下的那个 */
function pickSkillMd(files: { path: string; contents?: string | null }[]): string | null {
  const file = files.find((f) => f.path === 'SKILL.md') ?? files.find((f) => /(^|\/)SKILL\.md$/i.test(f.path))
  return file?.contents?.replace(/^﻿/, '').replace(/\r\n?/g, '\n') ?? null
}

export class SkillsShParser implements Parser<SkillsShRecord> {
  readonly version = 1

  async parse(doc: RawDocument, target: CrawlTarget): Promise<SourceRecord<SkillsShRecord>[]> {
    let json: unknown
    try {
      json = JSON.parse(doc.body)
    } catch (error) {
      throw new ParseError(target.url, '不是合法的 JSON', { cause: error })
    }
    const result = documentSchema.safeParse(json)
    if (!result.success) throw new ParseError(target.url, `数据结构不符合预期：${result.error.message}`)
    const { listing, skill, audits } = result.data
    const files = skill.files ?? []
    return [
      {
        sourceId: target.sourceId,
        kind: 'skill',
        externalId: target.externalId,
        url: doc.url,
        parserVersion: this.version,
        fetchedAt: doc.fetchedAt,
        data: {
          listing,
          installs: skill.installs ?? listing.installs ?? null,
          hash: skill.hash ?? null,
          skillMd: pickSkillMd(files),
          files: files.map((f) => f.path).filter((p) => !/(^|\/)SKILL\.md$/i.test(p)),
          audits,
        },
      },
    ]
  }
}
