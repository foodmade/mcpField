import { and, eq, sql } from 'drizzle-orm'
import type { EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { entityClaims, ingestPublished, ingestPublishedSlugs } from '../../../db/schema/index.ts'

export interface ClaimRow {
  kind: EntityKind
  slug: string
  userId: string
  userName: string
  githubId: number
  githubLogin: string
  githubAvatar: string | null
  repoFullName: string
  method: 'owner' | 'maintainer'
  claimedAt: Date
  revokedAt: Date | null
}

/** 可认领的条目：正式 slug 和关联的源码仓库（没有时为 null） */
export interface ClaimTarget {
  slug: string
  repository: { host: string; owner: string; name: string } | null
}

export interface ClaimRepository {
  /** 按 slug（含旧地址）找条目；不存在时返回 null */
  target(kind: EntityKind, slug: string): Promise<ClaimTarget | null>
  find(kind: EntityKind, slug: string): Promise<ClaimRow | null>
  /** 写入认领：已有的一行（含已撤销的）整行覆盖 */
  save(row: Omit<ClaimRow, 'revokedAt'>): Promise<void>
}

export class MysqlClaimRepository implements ClaimRepository {
  constructor(private readonly db: Db) {}

  async target(kind: EntityKind, slug: string): Promise<ClaimTarget | null> {
    const [row] = await this.db
      .select({ slug: ingestPublished.slug, repository: sql<unknown>`JSON_EXTRACT(${ingestPublished.draft}, '$.identity.repository')` })
      .from(ingestPublishedSlugs)
      .innerJoin(ingestPublished, eq(ingestPublished.id, ingestPublishedSlugs.publishedId))
      .where(and(eq(ingestPublishedSlugs.kind, kind), eq(ingestPublishedSlugs.slug, slug)))
      .limit(1)
    if (!row) return null
    const repo = (typeof row.repository === 'string' ? JSON.parse(row.repository) : row.repository) as ClaimTarget['repository']
    return { slug: row.slug, repository: repo?.host && repo.owner && repo.name ? { host: repo.host, owner: repo.owner, name: repo.name } : null }
  }

  async find(kind: EntityKind, slug: string): Promise<ClaimRow | null> {
    const [row] = await this.db
      .select({
        kind: entityClaims.kind,
        slug: entityClaims.slug,
        userId: entityClaims.userId,
        userName: entityClaims.userName,
        githubId: entityClaims.githubId,
        githubLogin: entityClaims.githubLogin,
        githubAvatar: entityClaims.githubAvatar,
        repoFullName: entityClaims.repoFullName,
        method: entityClaims.method,
        claimedAt: entityClaims.claimedAt,
        revokedAt: entityClaims.revokedAt,
      })
      .from(entityClaims)
      .where(and(eq(entityClaims.kind, kind), eq(entityClaims.slug, slug)))
      .limit(1)
    return row ?? null
  }

  async save(row: Omit<ClaimRow, 'revokedAt'>): Promise<void> {
    const values = { ...row, revokedAt: null, revokedBy: null }
    await this.db.insert(entityClaims).values(values).onDuplicateKeyUpdate({ set: values })
  }
}
