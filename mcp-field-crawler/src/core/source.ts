import type { AppConfig } from '../config.ts'
import type { Db } from '../db/client.ts'
import type { EntityDraft } from './draft.ts'
import type { Logger } from './logger.ts'
import type { CrawlTarget, EntityKind, FetchRequest, RawDocument, SourceRecord } from './types.ts'

/** 礼貌抓取参数：每个数据源可以单独设置 */
export interface Politeness {
  requestsPerSecond: number
  concurrency: number
  respectRobots: boolean
  maxRetries: number
  timeoutMs: number
}

export interface SourceMeta {
  /** 稳定的数据源 ID，会写进数据库，不能随意修改 */
  id: string
  name: string
  homepage: string
  kinds: readonly EntityKind[]
  politeness: Politeness
}

export interface DiscoverOptions {
  kinds: readonly EntityKind[]
  /** 每种类型最多发现多少个目标（抽样调试用） */
  limitPerKind?: number
  /** 只要 lastmod 晚于这个时间的目标（增量抓取） */
  since?: Date
  signal?: AbortSignal
}

/* ---------- 抽象工厂的四个产品 ---------- */

/** 产品 A：发现待抓取的目标 */
export interface Discoverer {
  discover(options: DiscoverOptions): AsyncIterable<CrawlTarget>
}

/** 产品 B：获取原始文档 */
export interface Fetcher {
  fetch(request: FetchRequest): Promise<RawDocument>
}

/** 产品 C：原始文档 → 源站原生记录 */
export interface Parser<T = unknown> {
  /** 解析逻辑变化时递增，便于找出需要重新解析的记录 */
  readonly version: number
  parse(doc: RawDocument, target: CrawlTarget): Promise<SourceRecord<T>[]>
}

/** 产品 D：源站原生记录 → 统一结构的细粒度实体草稿 */
export interface Mapper<T = unknown> {
  readonly version: number
  map(record: SourceRecord<T>): EntityDraft | null
}

export interface SourceContext {
  config: AppConfig
  logger: Logger
  /** 用 MySQL 存储时的数据库连接：数据源要读写补充数据时用（skills-sh 读仓库推送时间、记录排行榜安装量） */
  db?: Db
}

/**
 * 抽象工厂：每个数据源提供一整套相互匹配的产品（发现器、抓取器、解析器、映射器）。
 * 新增一个源站 = 新建一个工厂实现 + 在 bootstrap 里注册，运行器和存储层都不用改。
 */
export interface SourceFactory {
  readonly meta: SourceMeta
  createFetcher(ctx: SourceContext): Fetcher
  createDiscoverer(ctx: SourceContext, fetcher: Fetcher): Discoverer
  createParser(kind: EntityKind, ctx: SourceContext): Parser
  createMapper(kind: EntityKind, ctx: SourceContext): Mapper
}

/** 由工厂组装好的一整套产品，运行器只依赖它 */
export interface SourceKit {
  meta: SourceMeta
  fetcher: Fetcher
  discoverer: Discoverer
  parserFor(kind: EntityKind): Parser
  mapperFor(kind: EntityKind): Mapper
}

export function assembleKit(factory: SourceFactory, ctx: SourceContext): SourceKit {
  const fetcher = factory.createFetcher(ctx)
  const parsers = new Map<EntityKind, Parser>()
  const mappers = new Map<EntityKind, Mapper>()
  return {
    meta: factory.meta,
    fetcher,
    discoverer: factory.createDiscoverer(ctx, fetcher),
    parserFor(kind) {
      let parser = parsers.get(kind)
      if (!parser) parsers.set(kind, (parser = factory.createParser(kind, ctx)))
      return parser
    },
    mapperFor(kind) {
      let mapper = mappers.get(kind)
      if (!mapper) mappers.set(kind, (mapper = factory.createMapper(kind, ctx)))
      return mapper
    },
  }
}
