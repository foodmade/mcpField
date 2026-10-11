import { EventEmitter } from 'node:events'
import type { CrawlTarget, RawDocument } from './types.ts'

/** 运行过程中的事件，CLI 进度显示、指标统计等都通过订阅获得（观察者模式） */
export interface CrawlEventMap {
  discovered: [target: CrawlTarget]
  skipped: [target: CrawlTarget, reason: string]
  fetched: [target: CrawlTarget, doc: RawDocument]
  parsed: [target: CrawlTarget, records: number, drafts: number]
  failed: [target: CrawlTarget, error: Error]
}

export class CrawlEvents extends EventEmitter<CrawlEventMap> {}
