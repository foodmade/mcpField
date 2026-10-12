import { sql, type SQL } from 'drizzle-orm'
import type { EntityDraftOf } from '../../core/draft.ts'
import type { EntityKind } from '../../core/types.ts'
import type { Db } from '../../db/client.ts'
import type { MetricName } from '../../core/draft.ts'
import type { ListQuery, Scope } from '../http/query.ts'
import type { CategoryCount, EntityReadRepository, EntityRow, SitemapEntry, TypeCount, ViewCounts } from './types.ts'

/* 从草稿 JSON 中取值的 SQL 片段（d 为 ingest_drafts 的别名） */
const NAME = sql`JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.name'))`
const metric = (name: MetricName) =>
  sql`(SELECT m.value FROM JSON_TABLE(d.draft, '$.metrics[*]' COLUMNS (metric VARCHAR(32) PATH '$.metric', value BIGINT PATH '$.value')) m WHERE m.metric = ${name} LIMIT 1)`
const TEXTS = sql`JSON_TABLE(d.draft, '$.texts[*]' COLUMNS (field VARCHAR(24) PATH '$.field', locale VARCHAR(8) PATH '$.locale', format VARCHAR(16) PATH '$.format', content LONGTEXT PATH '$.content')) t`
/** 简介：优先 tagline，没有时用 description（Skill 只有 description） */
const TAGLINE = sql`(SELECT t.content FROM ${TEXTS} WHERE t.field IN ('tagline', 'description') AND t.locale = 'en' ORDER BY t.field = 'tagline' DESC LIMIT 1)`
const PRIMARY_CATEGORY = sql`JSON_EXTRACT(d.draft, '$.categories[0].slug')`
/** 列表用的草稿：去掉 README 等长文本，只保留简介类文本 */
const LIST_DRAFT = sql`JSON_SET(d.draft, '$.texts', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('field', t.field, 'locale', t.locale, 'format', t.format, 'content', t.content)) FROM ${TEXTS} WHERE t.field NOT IN ('readme', 'overview')), JSON_ARRAY()))`

const flag = (path: string, value: boolean) => sql`JSON_EXTRACT(d.draft, ${path}) = ${value ? sql`TRUE` : sql`FALSE`}`
/** JSON 里的字符串字段取成定长字符串；缺失或 JSON null 时为 SQL NULL */
const textAt = (path: string, len: number) => sql`CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${path})), 'null') AS CHAR(${sql.raw(String(len))}))`

/** 关联 GitHub 仓库统计（g，规则同 github/repo.ts 的 repoRef：repo:github.com/owner/name） */
const REPO_STATS = sql`LEFT JOIN ingest_enrichments g ON g.enricher = 'github_repo' AND g.status = 'ok'
  AND JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.host')) = 'github.com'
  AND g.subject_key = CONCAT('repo:github.com/', JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.owner')), '/', JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.name')))`
/** 星数、最近提交时间：GitHub 的优先，没抓到时用源站的 */
const STARS = sql`COALESCE(CAST(JSON_EXTRACT(g.data, '$.stars') AS SIGNED), ${metric('github_stars')})`
const LAST_COMMIT = sql`COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.data, '$.lastCommitAt')), 'null') AS CHAR(40)), ${textAt('$.lastCommitAt', 40)})`

/**
 * 排序键：先在派生表 k 里取成小字段再排序。直接对带草稿 JSON 的行排序时，
 * MySQL 会把整行（含几百 KB 的草稿）放进排序缓冲区，超出 sort_buffer_size 而报错。
 */
const sortKeys = (popularMetric: MetricName) => sql`d.id, d.external_id,
  ${textAt('$.name', 255)} AS name,
  ${popularMetric === 'github_stars' ? STARS : metric(popularMetric)} AS popularity, ${STARS} AS stars, ${metric('skill_installs')} AS installs,
  ${LAST_COMMIT} AS last_commit, ${textAt('$.sourceCreatedAt', 40)} AS created,
  (JSON_EXTRACT(d.draft, '$.flags.featured') = TRUE) AS featured`

const ORDER_BY: Record<ListQuery['sort'], SQL> = {
  // 热度相同（包括都没有热度指标，例如 Agent）时精选排在前面
  popular: sql`k.popularity IS NULL, k.popularity DESC, k.featured DESC, k.external_id`,
  stars: sql`k.stars IS NULL, k.stars DESC, k.external_id`,
  installs: sql`k.installs IS NULL, k.installs DESC, k.external_id`,
  name: sql`LOWER(k.name), k.external_id`,
  updated: sql`k.last_commit IS NULL, k.last_commit DESC, k.external_id`,
  newest: sql`k.created IS NULL, k.created DESC, k.external_id`,
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

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
  sourceId?: string
  /** sort=popular 使用的指标 */
  popularMetric?: MetricName
  /** 子类型字段在草稿里的 JSON 路径（Agent：$.detail.agentType）；没有时忽略 type 参数 */
  typePath?: string
}

/** 基于 ingest_drafts 的只读仓储，按实体类型和数据源过滤 */
export class DraftEntityRepository<K extends EntityKind> implements EntityReadRepository<K> {
  private readonly sourceId: string
  private readonly popularMetric: MetricName
  private readonly typePath: string | undefined

  constructor(
    private readonly db: Db,
    private readonly kind: K,
    options: DraftRepositoryOptions = {},
  ) {
    this.sourceId = options.sourceId ?? 'mcpso'
    this.popularMetric = options.popularMetric ?? 'github_stars'
    this.typePath = options.typePath
  }

  /** 类型、数据源和统计范围（远程服务）条件 */
  private base(scope: Scope = {}): SQL[] {
    const conditions: SQL[] = [sql`d.kind = ${this.kind}`, sql`d.source_id = ${this.sourceId}`]
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

  private where(query: ListQuery): SQL {
    const conditions = this.base(query)
    if (query.q) {
      const like = `%${escapeLike(query.q.toLowerCase())}%`
      // 简介的译文也参与搜索：用与采集端相同的规范化规则算出原文指纹，关联翻译记忆库
      const translated = sql`EXISTS (SELECT 1 FROM ingest_translations tr WHERE tr.source_hash = SHA2(TRIM(REGEXP_REPLACE(${TAGLINE}, '[[:space:]]+', ' ')), 256) AND LOWER(tr.content) LIKE ${like})`
      // 我们自己撰写的简介（Loop / CLI / Agent）也参与搜索
      const generated = sql`EXISTS (SELECT 1 FROM ingest_generated_texts g WHERE g.source_id = d.source_id AND g.kind = d.kind AND g.external_id = d.external_id AND g.field = 'tagline' AND LOWER(g.content) LIKE ${like})`
      conditions.push(sql`(LOWER(${NAME}) LIKE ${like} OR d.external_id LIKE ${like} OR LOWER(${TAGLINE}) LIKE ${like} OR ${translated} OR ${generated})`)
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

  async list(query: ListQuery): Promise<{ rows: EntityRow<K>[]; total: number }> {
    const where = this.where(query)
    const offset = (query.page - 1) * query.pageSize
    // 先在派生表里只取排序键排好序拿到 id（NO_MERGE 保证派生表单独物化），再按 id 回表取草稿
    const [ids, [count]] = await Promise.all([
      this.rows<{ id: number }>(sql`
        SELECT /*+ NO_MERGE(k) */ k.id
        FROM (SELECT ${sortKeys(this.popularMetric)} FROM ingest_drafts d ${REPO_STATS} WHERE ${where}) k
        ORDER BY ${ORDER_BY[query.sort]}
        LIMIT ${query.pageSize} OFFSET ${offset}`),
      this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total FROM ingest_drafts d WHERE ${where}`),
    ])
    if (ids.length === 0) return { rows: [], total: Number(count?.total ?? 0) }
    const rows = await this.rows<RawRow & { id: number }>(sql`
      SELECT d.id, ${LIST_DRAFT} AS draft, r.fetched_at, d.mapped_at
      FROM ingest_drafts d JOIN ingest_records r ON r.id = d.record_id
      WHERE d.id IN (${sql.join(ids.map((r) => sql`${r.id}`), sql`, `)})`)
    const byId = new Map(rows.map((r) => [Number(r.id), r]))
    return {
      rows: ids.flatMap((r) => {
        const row = byId.get(Number(r.id))
        return row ? [this.toEntityRow(row)] : []
      }),
      total: Number(count?.total ?? 0),
    }
  }

  async findBySlug(slug: string): Promise<EntityRow<K> | null> {
    const [row] = await this.rows<RawRow>(sql`
      SELECT d.draft, r.fetched_at, d.mapped_at
      FROM ingest_drafts d JOIN ingest_records r ON r.id = d.record_id
      WHERE d.kind = ${this.kind} AND d.source_id = ${this.sourceId} AND d.external_id = ${slug}
      LIMIT 1`)
    return row ? this.toEntityRow(row) : null
  }

  async viewCounts(scope?: Scope): Promise<ViewCounts> {
    const [row] = await this.rows<Record<keyof ViewCounts, number | string | null>>(sql`
      SELECT SUM(JSON_EXTRACT(d.draft, '$.flags.official') = TRUE) AS official,
             SUM(JSON_EXTRACT(d.draft, '$.flags.featured') = TRUE) AS featured,
             SUM(JSON_EXTRACT(d.draft, '$.flags.verified') = TRUE) AS verified
      FROM ingest_drafts d
      WHERE ${sql.join(this.base(scope), sql` AND `)}`)
    return { official: Number(row?.official ?? 0), featured: Number(row?.featured ?? 0), verified: Number(row?.verified ?? 0) }
  }

  async sitemap(offset: number, limit: number): Promise<{ rows: SitemapEntry[]; total: number }> {
    const where = sql.join(this.base(), sql` AND `)
    // 先只按 id 排序分页，再回表取更新时间：直接带着草稿 JSON 排序上万行会超出 MySQL 的排序缓冲区
    const [rows, [count]] = await Promise.all([
      this.rows<{ slug: string; updated_at: string | null }>(sql`
        SELECT JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.slug')) AS slug,
               COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.sourceUpdatedAt')), JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.lastCommitAt'))) AS updated_at
        FROM (SELECT d.id FROM ingest_drafts d WHERE ${where} ORDER BY d.external_id LIMIT ${limit} OFFSET ${offset}) page
        JOIN ingest_drafts d ON d.id = page.id`),
      this.rows<{ total: number | string }>(sql`SELECT COUNT(*) AS total FROM ingest_drafts d WHERE ${where}`),
    ])
    return {
      rows: rows
        .map((r) => ({ slug: r.slug, updatedAt: r.updated_at && r.updated_at !== 'null' ? r.updated_at : null }))
        .sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0)),
      total: Number(count?.total ?? 0),
    }
  }

  async typeCounts(scope?: Scope): Promise<TypeCount[]> {
    if (!this.typePath) return []
    const rows = await this.rows<{ value: string; count: number | string }>(sql`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${this.typePath})) AS value, COUNT(*) AS count
      FROM ingest_drafts d
      WHERE ${sql.join(this.base(scope), sql` AND `)} AND JSON_TYPE(JSON_EXTRACT(d.draft, ${this.typePath})) = 'STRING'
      GROUP BY value
      ORDER BY count DESC`)
    return rows.map((r) => ({ value: r.value, count: Number(r.count) }))
  }

  async categoryCounts(scope?: Scope): Promise<CategoryCount[]> {
    const rows = await this.rows<{ slug: string | null; source_value: string; count: number | string }>(sql`
      SELECT c.slug, c.source_value, COUNT(*) AS count
      FROM ingest_drafts d,
           JSON_TABLE(d.draft, '$.categories[*]' COLUMNS (slug VARCHAR(64) PATH '$.slug', source_value VARCHAR(128) PATH '$.sourceValue', is_primary JSON PATH '$.primary')) c
      WHERE ${sql.join(this.base(scope), sql` AND `)} AND c.is_primary = TRUE
      GROUP BY c.slug, c.source_value
      ORDER BY count DESC`)
    return rows.map((r) => ({ slug: r.slug === 'null' ? null : r.slug, sourceValue: r.source_value, count: Number(r.count) }))
  }
}
