import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { ingestEnrichments } from '../db/schema/index.ts'
import { sha256 } from '../store/hash.ts'
import type { GithubReadme } from './readme.ts'
import type { RepoStats } from './repo.ts'

export const README_ENRICHER = 'github_readme'
export const REPO_ENRICHER = 'github_repo'

/** ok：已抓到 / not_found：仓库或 README 不存在 / too_large：超过 1MB / error：临时错误，稍后重试 */
export type ReadmeFetchStatus = 'ok' | 'not_found' | 'too_large' | 'error'

export interface ReadmeFetchState {
  status: ReadmeFetchStatus
  etag: string | null
  /** 上次抓到的文件路径：Skill 直接按路径取，不必再找 */
  path: string | null
  /** 连续失败次数（只有 error 记录） */
  attempts: number
  expiresAt: Date | null
}

/** 按主体查 README：接口、README 翻译、AI 介绍只依赖这个接口 */
export interface GithubReadmeReader {
  find(keys: string[]): Promise<Map<string, GithubReadme>>
}

const CHUNK = 500

/** mysql2 读出的 JSON 列可能是字符串 */
const parse = <T>(value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as T

/** GitHub README 补抓结果，存在 ingest_enrichments（enricher = github_readme，一个主体一行） */
export class GithubReadmeStore implements GithubReadmeReader {
  constructor(private readonly db: Db) {}

  async states(keys: string[]): Promise<Map<string, ReadmeFetchState>> {
    const out = new Map<string, ReadmeFetchState>()
    for (let i = 0; i < keys.length; i += CHUNK) {
      const rows = await this.db
        .select({
          key: ingestEnrichments.subjectKey,
          status: ingestEnrichments.status,
          etag: ingestEnrichments.etag,
          // 只取路径和次数，不读整篇正文
          path: sql<string | null>`JSON_UNQUOTE(JSON_EXTRACT(${ingestEnrichments.data}, '$.path'))`,
          attempts: sql<number | null>`JSON_EXTRACT(${ingestEnrichments.data}, '$.attempts')`,
          expiresAt: ingestEnrichments.expiresAt,
        })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, README_ENRICHER), inArray(ingestEnrichments.subjectKey, keys.slice(i, i + CHUNK))))
      for (const r of rows) {
        out.set(r.key, { status: r.status as ReadmeFetchStatus, etag: r.etag, path: r.path, attempts: Number(r.attempts ?? 0), expiresAt: r.expiresAt })
      }
    }
    return out
  }

  async saveOk(key: string, readme: GithubReadme, etag: string | null, expiresAt: Date): Promise<void> {
    await this.upsert(key, { status: 'ok', httpStatus: 200, etag, contentHash: sha256(readme.content), data: readme, error: null, fetchedAt: new Date(), expiresAt })
  }

  /** 304：内容没变，只延后下次检查时间 */
  async saveNotModified(key: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(ingestEnrichments)
      .set({ httpStatus: 304, error: null, fetchedAt: new Date(), expiresAt })
      .where(and(eq(ingestEnrichments.enricher, README_ENRICHER), eq(ingestEnrichments.subjectKey, key)))
  }

  async saveMissing(key: string, status: 'not_found' | 'too_large', httpStatus: number, reason: string, expiresAt: Date): Promise<void> {
    await this.upsert(key, { status, httpStatus, etag: null, contentHash: null, data: null, error: reason.slice(0, 1024), fetchedAt: new Date(), expiresAt })
  }

  /** 临时错误：已经抓到过的保留原内容，只记录错误和重试时间 */
  async saveError(key: string, error: string, httpStatus: number | null, attempts: number, expiresAt: Date, keepContent: boolean): Promise<void> {
    if (keepContent) {
      await this.db
        .update(ingestEnrichments)
        .set({ error: error.slice(0, 1024), fetchedAt: new Date(), expiresAt })
        .where(and(eq(ingestEnrichments.enricher, README_ENRICHER), eq(ingestEnrichments.subjectKey, key)))
      return
    }
    await this.upsert(key, { status: 'error', httpStatus, etag: null, contentHash: null, data: { attempts }, error: error.slice(0, 1024), fetchedAt: new Date(), expiresAt })
  }

  async find(keys: string[]): Promise<Map<string, GithubReadme>> {
    const out = new Map<string, GithubReadme>()
    const unique = [...new Set(keys)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await this.db
        .select({ key: ingestEnrichments.subjectKey, data: ingestEnrichments.data })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, README_ENRICHER), eq(ingestEnrichments.status, 'ok'), inArray(ingestEnrichments.subjectKey, unique.slice(i, i + CHUNK))))
      for (const r of rows) if (r.data) out.set(r.key, parse<GithubReadme>(r.data))
    }
    return out
  }

  /** 只取正文哈希（发布时判断页面内容是否变化），不读整篇正文；没抓到的不在结果里 */
  async hashes(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const unique = [...new Set(keys)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await this.db
        .select({ key: ingestEnrichments.subjectKey, hash: ingestEnrichments.contentHash })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, README_ENRICHER), inArray(ingestEnrichments.subjectKey, unique.slice(i, i + CHUNK))))
      for (const r of rows) if (r.hash) out.set(r.key, r.hash)
    }
    return out
  }

  private async upsert(key: string, values: Omit<typeof ingestEnrichments.$inferInsert, 'enricher' | 'subjectKey'>): Promise<void> {
    await this.db
      .insert(ingestEnrichments)
      .values({ enricher: README_ENRICHER, subjectKey: key, ...values })
      .onDuplicateKeyUpdate({ set: values })
  }
}

/** 按主体查仓库统计：接口只依赖这个接口 */
export interface GithubRepoReader {
  find(keys: string[]): Promise<Map<string, RepoStats>>
}

/** GitHub 仓库统计（星数、最近提交时间），存在 ingest_enrichments（enricher = github_repo，一个仓库一行），每次运行整批覆盖 */
export class GithubRepoStore implements GithubRepoReader {
  constructor(private readonly db: Db) {}

  /** 一批结果一次写入；null 表示仓库不存在或无法访问 */
  async save(results: Map<string, RepoStats | null>, expiresAt: Date): Promise<void> {
    const fetchedAt = new Date()
    const rows = [...results].map(([key, stats]) => ({
      enricher: REPO_ENRICHER,
      subjectKey: key,
      status: stats ? 'ok' : 'not_found',
      httpStatus: 200,
      data: stats,
      error: stats ? null : '仓库不存在或无法访问',
      fetchedAt,
      expiresAt,
    }))
    if (rows.length === 0) return
    await this.db
      .insert(ingestEnrichments)
      .values(rows)
      .onDuplicateKeyUpdate({
        set: {
          status: sql`VALUES(status)`,
          httpStatus: sql`VALUES(http_status)`,
          data: sql`VALUES(data)`,
          error: sql`VALUES(error)`,
          fetchedAt: sql`VALUES(fetched_at)`,
          expiresAt: sql`VALUES(expires_at)`,
        },
      })
  }

  async find(keys: string[]): Promise<Map<string, RepoStats>> {
    const out = new Map<string, RepoStats>()
    const unique = [...new Set(keys)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await this.db
        .select({ key: ingestEnrichments.subjectKey, data: ingestEnrichments.data })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, REPO_ENRICHER), eq(ingestEnrichments.status, 'ok'), inArray(ingestEnrichments.subjectKey, unique.slice(i, i + CHUNK))))
      for (const r of rows) if (r.data) out.set(r.key, parse<RepoStats>(r.data))
    }
    return out
  }
}
