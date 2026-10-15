import { sql, type SQL } from 'drizzle-orm'
import type { EntityDraftOf } from '../../core/draft.ts'
import type { EntityKind } from '../../core/types.ts'
import type { Db } from '../../db/client.ts'
import type { MetricName } from '../../core/draft.ts'
import { FEATURED, metric, NAME, popularity, popularityNeedsRepo, REPO_STATS, STARS, TAGLINE, TEXTS, textAt } from '../../db/published-sql.ts'
import type { ListQuery, Scope } from '../http/query.ts'
import type { CategoryCount, EntityReadRepository, EntityRow, SitemapEntry, TypeCount, ViewCounts } from './types.ts'

/* 从草稿 JSON 中取值的 SQL 片段（d 为 ingest_published 的别名）；与搜索表同步共用的在 db/published-sql.ts */
const PRIMARY_CATEGORY = sql`JSON_EXTRACT(d.draft, '$.categories[0].slug')`
/** 列表用的草稿：去掉 README 等长文本，只保留简介类文本 */
const LIST_DRAFT = sql`JSON_SET(d.draft, '$.texts', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('field', t.field, 'locale', t.locale, 'format', t.format, 'content', t.content)) FROM ${TEXTS} WHERE t.field NOT IN ('readme', 'overview')), JSON_ARRAY()))`

const flag = (path: string, value: boolean) => sql`JSON_EXTRACT(d.draft, ${path}) = ${value ? sql`TRUE` : sql`FALSE`}`
/** 最近提交时间：GitHub 的优先，没抓到时用源站的 */
const LAST_COMMIT = sql`COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.data, '$.lastCommitAt')), 'null') AS CHAR(40)), ${textAt('$.lastCommitAt', 40)})`

/**
 * 排序键：先在派生表 k 里取成小字段再排序。直接对带草稿 JSON 的行排序时，
 * MySQL 会把整行（含几百 KB 的草稿）放进排序缓冲区，超出 sort_buffer_size 而报错。
 * 派生表要对该类型的每一行求值，所以只算本次排序用到的键（v）；用到星数、最近提交时间时才关联 GitHub 统计表（repo）。
 */
type SortSpec = { keys: SQL; order: SQL; repo: boolean }
const desc = (key: SQL, repo = false): SortSpec => ({ keys: sql`${key} AS v`, order: sql`k.v IS NULL, k.v DESC, k.slug`, repo })

const SORTS: Record<ListQuery['sort'], (popularMetric: MetricName) => SortSpec> = {
  // 热度相同（包括都没有热度指标，例如 Agent）时精选排在前面
  popular: (m) => ({
    keys: sql`${popularity(m)} AS v, ${FEATURED} AS featured`,
    order: sql`k.v IS NULL, k.v DESC, k.featured DESC, k.slug`,
    repo: popularityNeedsRepo(m),
  }),
  stars: () => desc(STARS, true),
  installs: () => desc(metric('skill_installs')),
  name: () => ({ keys: sql`${textAt('$.name', 255)} AS v`, order: sql`LOWER(k.v), k.slug`, repo: false }),
  updated: () => desc(LAST_COMMIT, true),
  newest: () => desc(textAt('$.sourceCreatedAt', 40)),
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** 关键词的 LIKE 模式：包含即命中 */
const likeOf = (q: string) => `%${escapeLike(q.toLowerCase())}%`

/** mysql2 对原生查询可能返回 Date 或 'YYYY-MM-DD HH:MM:SS.mmm'（UTC）字符串 */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value).replace(' ', 'T') + 'Z').toISOString()
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

interface RawRow {
  draft: unknown
  fetched_at: unknown
  mapped_at: unknown
}

export interface DraftRepositoryOptions {
  /** 只要主条目来自这个数据源的；默认全部 */
  sourceId?: string
  /** sort=popular 使用的指标 */
  popularMetric?: MetricName
  /** 子类型字段在草稿里的 JSON 路径（Agent：$.detail.agentType）；没有时忽略 type 参数 */
  typePath?: string
}

/** 基于发布层 ingest_published 的只读仓储（各来源合并后、一组一行），按实体类型过滤 */
export class DraftEntityRepository<K extends EntityKind> implements EntityReadRepository<K> {
  private readonly sourceId: string | undefined
  private readonly popularMetric: MetricName
  private readonly typePath: string | undefined
  private searchCheck: { at: number; ready: Promise<boolean> } | undefined

  constructor(
    private readonly db: Db,
    private readonly kind: K,
    options: DraftRepositoryOptions = {},
  ) {
    this.sourceId = options.sourceId
    this.popularMetric = options.popularMetric ?? 'github_stars'
    this.typePath = options.typePath
  }

  /** 类型、数据源和统计范围（远程服务）条件 */
  private base(scope: Scope = {}): SQL[] {
    const conditions: SQL[] = [sql`d.kind = ${this.kind}`]
    if (this.sourceId) conditions.push(sql`d.source_id = ${this.sourceId}`)
    if (scope.remote !== undefined) conditions.push(flag('$.detail.isRemote', scope.remote))
    return conditions
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    const [rows] = (await this.db.execute(query)) as unknown as [T[]]
    return rows
  }

  private toEntityRow(row: RawRow): EntityRow<K> {
    return { draft: parseJson<EntityDraftOf<K>>(row.draft), fetchedAt: toIso(row.fetched_at), mappedAt: toIso(row.mapped_at) }
  }

  /** 搜索表里有没有这个类型（新部署还没跑过 search-index 时退回直接查发布层）；结果缓存一分钟 */
  private searchReady(): Promise<boolean> {
    if (!this.searchCheck || Date.now() - this.searchCheck.at > 60_000) {
      const ready = this.rows(sql`SELECT 1 FROM ingest_search WHERE kind = ${this.kind} LIMIT 1`).then(
        (r) => r.length > 0,
        () => false,
      )
      this.searchCheck = { at: Date.now(), ready }
    }
    return this.searchCheck.ready
  }

  /** 热门排序、除关键词外没有别的筛选：顺序和条件都在搜索表里，不用碰发布层的草稿 */
  private bySearchTable(query: ListQuery): boolean {
    return (
      query.sort === 'popular' &&
      !this.sourceId &&
      query.remote === undefined &&
      !query.category &&
      query.featured === undefined &&
      query.verified === undefined &&
      query.official === undefined &&
      !(query.type && this.typePath)
    )
  }

  /** 列表用的草稿（不含 README 等长文本） */
  private listDrafts(condition: SQL): Promise<(RawRow & { id: number; slug: string })[]> {
    return this.rows(sql`
      SELECT d.id, d.slug, ${LIST_DRAFT} AS draft, r.fetched_at, d.mapped_at
      FROM ingest_published d JOIN ingest_records r ON r.id = d.record_id
      WHERE ${condition}`)
  }

  private where(query: ListQuery, search: boolean): SQL {
    const conditions = this.base(query)
    if (query.q && search) {
      // 名称、slug、英文简介、当前语言的简介译文、自撰简介都预先放进了搜索表的 body（search/rows.ts）
      conditions.push(sql`d.slug IN (SELECT s.slug FROM ingest_search s WHERE s.kind = ${this.kind} AND s.locale = ${query.locale} AND s.body LIKE ${likeOf(query.q)})`)
    } else if (query.q) {
      // 搜索表还没生成时的旧查法（每行现算译文指纹，很慢）
      const like = likeOf(query.q)
      // 简介的译文也参与搜索：用与采集端相同的规范化规则算出原文指纹，关联翻译记忆库。
      // 只匹配当前语言的译文（每行少比对两种语言）；content 列是 utf8mb4_unicode_ci，本身不区分大小写，不用 LOWER
      const translated = sql`EXISTS (SELECT 1 FROM ingest_translations tr WHERE tr.source_hash = SHA2(TRIM(REGEXP_REPLACE(${TAGLINE}, '[[:space:]]+', ' ')), 256) AND tr.locale = ${query.locale} AND tr.content LIKE ${like})`
      // 我们自己撰写的简介（Loop / CLI / Agent）也参与搜索
      const generated = sql`EXISTS (SELECT 1 FROM ingest_generated_texts g WHERE g.source_id = d.source_id AND g.kind = d.kind AND g.external_id = d.external_id AND g.field = 'tagline' AND g.content LIKE ${like})`
      conditions.push(sql`(LOWER(${NAME}) LIKE ${like} OR d.slug LIKE ${like} OR LOWER(${TAGLINE}) LIKE ${like} OR ${translated} OR ${generated})`)
    }
    if (query.category === 'none') {
      conditions.push(sql`(${PRIMARY_CATEGORY} IS NULL OR JSON_TYPE(${PRIMARY_CATEGORY}) = 'NULL')`)
    } else if (query.category) {
      conditions.push(sql`JSON_CONTAINS(JSON_EXTRACT(d.draft, '$.categories[*].slug'), JSON_QUOTE(${query.category}))`)
    }
    if (query.featured !== undefined) conditions.push(flag('$.flags.featured', query.featured))
    if (query.verified !== undefined) conditions.push(flag('$.flags.verified', query.verified))
    if (query.official !== undefined) conditions.push(flag('$.flags.official', query.official))
    if (query.type && this.typePath) conditions.push(sql`JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${this.typePath})) = ${query.type}`)
    return sql.join(conditions, sql` AND `)
  }

  /** 按搜索表的主键（类型 → 语言 → 热度 → 精选 → slug）顺序取一页：不用排序，凑够一页就停 */
  private async listFromSearch(query: ListQuery): Promise<{ rows: EntityRow<K>[]; total: number | null }> {
    const from = sql`FROM ingest_search s WHERE s.kind = ${this.kind} AND s.locale = ${query.locale}${query.q ? sql` AND s.body LIKE ${likeOf(query.q)}` : sql``}`
    const [page, count] = await Promise.all([
      this.rows<{ slug: string }>(sql`SELECT s.slug ${from} ORDER BY s.pop_rank, s.featured_rank, s.slug LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
      query.withTotal ? this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total ${from}`) : undefined,
    ])
    const total = count ? Number(count[0]?.total ?? 0) : null
    if (page.length === 0) return { rows: [], total }
    const drafts = await this.listDrafts(sql`d.kind = ${this.kind} AND d.slug IN (${sql.join(page.map((r) => sql`${r.slug}`), sql`, `)})`)
    const bySlug = new Map(drafts.map((r) => [r.slug, r]))
    return {
      // 搜索表比发布层晚同步时，已下架的条目在这里跳过
      rows: page.flatMap((r) => {
        const row = bySlug.get(r.slug)
        return row ? [this.toEntityRow(row)] : []
      }),
      total,
    }
  }

  async list(query: ListQuery): Promise<{ rows: EntityRow<K>[]; total: number | null }> {
    const search = await this.searchReady()
    if (search && this.bySearchTable(query)) return this.listFromSearch(query)
    const where = this.where(query, search)
    const offset = (query.page - 1) * query.pageSize
    const sort = SORTS[query.sort](this.popularMetric)
    // 先在派生表里只取排序键排好序拿到 id（NO_MERGE 保证派生表单独物化），再按 id 回表取草稿。
    // 总数用窗口函数在同一条查询里顺带算出：派生表本来就要对所有命中行求值，不必再单独跑一遍同样的过滤
    const ids = await this.rows<{ id: number; total?: number | string }>(sql`
      SELECT /*+ NO_MERGE(k) */ k.id${query.withTotal ? sql`, COUNT(*) OVER () AS total` : sql``}
      FROM (SELECT d.id, d.slug, ${sort.keys} FROM ingest_published d ${sort.repo ? REPO_STATS : sql``} WHERE ${where}) k
      ORDER BY ${sort.order}
      LIMIT ${query.pageSize} OFFSET ${offset}`)
    let total: number | null = null
    if (query.withTotal) {
      if (ids.length > 0) total = Number(ids[0]!.total)
      else if (offset === 0) total = 0
      else {
        // 页码超出范围：这一页没有行、拿不到窗口函数的结果，才单独数一次
        const [count] = await this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total FROM ingest_published d WHERE ${where}`)
        total = Number(count?.total ?? 0)
      }
    }
    if (ids.length === 0) return { rows: [], total }
    const rows = await this.listDrafts(sql`d.id IN (${sql.join(ids.map((r) => sql`${r.id}`), sql`, `)})`)
    const byId = new Map(rows.map((r) => [Number(r.id), r]))
    return {
      rows: ids.flatMap((r) => {
        const row = byId.get(Number(r.id))
        return row ? [this.toEntityRow(row)] : []
      }),
      total,
    }
  }

  async findBySlug(slug: string): Promise<EntityRow<K> | null> {
    // 除了条目自己的地址，被合并进来的重复条目原来的地址也能找到它
    const [row] = await this.rows<RawRow>(sql`
      SELECT d.draft, r.fetched_at, d.mapped_at
      FROM ingest_published_slugs s
      JOIN ingest_published d ON d.id = s.published_id
      JOIN ingest_records r ON r.id = d.record_id
      WHERE s.kind = ${this.kind} AND s.slug = ${slug}
      LIMIT 1`)
    return row ? this.toEntityRow(row) : null
  }

  async viewCounts(scope?: Scope): Promise<ViewCounts> {
    const [row] = await this.rows<Record<keyof ViewCounts, number | string | null>>(sql`
      SELECT SUM(JSON_EXTRACT(d.draft, '$.flags.official') = TRUE) AS official,
             SUM(JSON_EXTRACT(d.draft, '$.flags.featured') = TRUE) AS featured,
             SUM(JSON_EXTRACT(d.draft, '$.flags.verified') = TRUE) AS verified
      FROM ingest_published d
      WHERE ${sql.join(this.base(scope), sql` AND `)}`)
    return { official: Number(row?.official ?? 0), featured: Number(row?.featured ?? 0), verified: Number(row?.verified ?? 0) }
  }

  async sitemap(offset: number, limit: number): Promise<{ rows: SitemapEntry[]; total: number }> {
    const where = sql.join(this.base(), sql` AND `)
    // 先只按 id 排序分页，再回表取更新时间：直接带着草稿 JSON 排序上万行会超出 MySQL 的排序缓冲区
    // 更新时间用页面内容最后变化的时间：源站的更新时间会批量刷新，不代表内容变了（见 merge/publish.ts contentHash）
    const [rows, [count]] = await Promise.all([
      this.rows<{ slug: string; updated_at: unknown }>(sql`
        SELECT JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.slug')) AS slug, d.content_changed_at AS updated_at
        FROM (SELECT d.id FROM ingest_published d WHERE ${where} ORDER BY d.slug LIMIT ${limit} OFFSET ${offset}) page
        JOIN ingest_published d ON d.id = page.id`),
      this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total FROM ingest_published d WHERE ${where}`),
    ])
    return {
      rows: rows
        .map((r) => ({ slug: r.slug, updatedAt: r.updated_at ? toIso(r.updated_at) : null }))
        .sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0)),
      total: Number(count?.total ?? 0),
    }
  }

  async typeCounts(scope?: Scope): Promise<TypeCount[]> {
    if (!this.typePath) return []
    const rows = await this.rows<{ value: string; count: number | string }>(sql`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${this.typePath})) AS value, COUNT(*) AS count
      FROM ingest_published d
      WHERE ${sql.join(this.base(scope), sql` AND `)} AND JSON_TYPE(JSON_EXTRACT(d.draft, ${this.typePath})) = 'STRING'
      GROUP BY value
      ORDER BY count DESC`)
    return rows.map((r) => ({ value: r.value, count: Number(r.count) }))
  }

  async categoryCounts(scope?: Scope): Promise<CategoryCount[]> {
    const where = sql.join(this.base(scope), sql` AND `)
    // 来源没有给分类的条目（官方 Registry 的都没有）算作 slug 为空，和"其他"一起统计
    const rows = await this.rows<{ slug: string | null; source_value: string; count: number | string }>(sql`
      SELECT c.slug, c.source_value, COUNT(*) AS count
      FROM ingest_published d,
           JSON_TABLE(d.draft, '$.categories[*]' COLUMNS (slug VARCHAR(64) PATH '$.slug', source_value VARCHAR(128) PATH '$.sourceValue', is_primary JSON PATH '$.primary')) c
      WHERE ${where} AND c.is_primary = TRUE
      GROUP BY c.slug, c.source_value
      UNION ALL
      SELECT NULL, '', COUNT(*) FROM ingest_published d WHERE ${where} AND JSON_LENGTH(JSON_EXTRACT(d.draft, '$.categories')) = 0 HAVING COUNT(*) > 0
      ORDER BY count DESC`)
    return rows.map((r) => ({ slug: r.slug === 'null' ? null : r.slug, sourceValue: r.source_value, count: Number(r.count) }))
  }
}
