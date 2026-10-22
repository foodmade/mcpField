import { sql } from 'drizzle-orm'
import type { MetricName } from '../core/draft.ts'

/*
 * 从发布层草稿 JSON 中取值的 SQL 片段（d 为 ingest_published 的别名）。
 * 列表接口、搜索表同步（search/sync.ts）和列表键表同步（list-keys/sync.ts）共用，保证几边的名称、简介、热度算法一致。
 */

export const NAME = sql`JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.name'))`
export const metric = (name: MetricName) =>
  sql`(SELECT m.value FROM JSON_TABLE(d.draft, '$.metrics[*]' COLUMNS (metric VARCHAR(32) PATH '$.metric', value BIGINT PATH '$.value')) m WHERE m.metric = ${name} LIMIT 1)`
export const TEXTS = sql`JSON_TABLE(d.draft, '$.texts[*]' COLUMNS (field VARCHAR(24) PATH '$.field', locale VARCHAR(8) PATH '$.locale', format VARCHAR(16) PATH '$.format', content LONGTEXT PATH '$.content')) t`
/** 简介：优先 tagline，没有时用 description（Skill 只有 description） */
export const TAGLINE = sql`(SELECT t.content FROM ${TEXTS} WHERE t.field IN ('tagline', 'description') AND t.locale = 'en' ORDER BY t.field = 'tagline' DESC LIMIT 1)`
export const FEATURED = sql`(JSON_EXTRACT(d.draft, '$.flags.featured') = TRUE)`

/** JSON 里的字符串字段取成定长字符串；缺失或 JSON null 时为 SQL NULL */
export const textAt = (path: string, len: number) => sql`CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(d.draft, ${path})), 'null') AS CHAR(${sql.raw(String(len))}))`

/** 关联 GitHub 仓库统计（g，规则同 github/repo.ts 的 repoRef：repo:github.com/owner/name） */
export const REPO_STATS = sql`LEFT JOIN ingest_enrichments g ON g.enricher = 'github_repo' AND g.status = 'ok'
  AND JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.host')) = 'github.com'
  AND g.subject_key = CONCAT('repo:github.com/', JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.owner')), '/', JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.name')))`
/** 星数：GitHub 的优先，没抓到时用源站的（需要 REPO_STATS） */
export const STARS = sql`COALESCE(CAST(JSON_EXTRACT(g.data, '$.stars') AS SIGNED), ${metric('github_stars')})`

/** 最近提交时间：GitHub 的优先，没抓到时用源站的（需要 REPO_STATS） */
export const LAST_COMMIT = sql`COALESCE(CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(g.data, '$.lastCommitAt')), 'null') AS CHAR(40)), ${textAt('$.lastCommitAt', 40)})`

/** 热度：该类型 sort=popular 用的指标；星数需要关联 REPO_STATS */
export const popularity = (m: MetricName) => (m === 'github_stars' ? STARS : metric(m))
export const popularityNeedsRepo = (m: MetricName) => m === 'github_stars'
