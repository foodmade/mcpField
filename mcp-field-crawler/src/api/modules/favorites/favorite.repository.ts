import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { ingestPublished, ingestPublishedSlugs, userFavorites } from '../../../db/schema/index.ts'

export interface FavoriteRow {
  kind: EntityKind
  /** 收藏时存下的地址 */
  slug: string
  /** 条目现在的正式地址（被合并后是代表条目的）；条目已下架时为 null */
  canonical: string | null
  name: string
  favoritedAt: Date
}

/** 地址解析的结果：正式地址和名称 */
export interface ResolvedEntity {
  slug: string
  name: string
}

export interface FavoriteRepository {
  /** 按地址（含被合并条目的旧地址）找到条目；不存在时不在结果里。返回 旧地址 → 条目 */
  resolve(kind: EntityKind, slugs: string[]): Promise<Map<string, ResolvedEntity>>
  /** 某人的全部收藏，最近收藏的在前 */
  list(userId: string, limit: number): Promise<FavoriteRow[]>
  count(userId: string): Promise<number>
  /** 收藏；已收藏的保持原来的收藏时间 */
  add(userId: string, kind: EntityKind, entity: ResolvedEntity, favoritedAt: Date): Promise<void>
  /** 取消收藏：同一条目的所有地址（自己的和被合并条目的旧地址）一起删除 */
  remove(userId: string, kind: EntityKind, slug: string): Promise<void>
}

export class MysqlFavoriteRepository implements FavoriteRepository {
  constructor(private readonly db: Db) {}

  async resolve(kind: EntityKind, slugs: string[]): Promise<Map<string, ResolvedEntity>> {
    if (slugs.length === 0) return new Map()
    const rows = await this.db
      .select({ alias: ingestPublishedSlugs.slug, slug: ingestPublished.slug, name: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${ingestPublished.draft}, '$.name'))` })
      .from(ingestPublishedSlugs)
      .innerJoin(ingestPublished, eq(ingestPublished.id, ingestPublishedSlugs.publishedId))
      .where(and(eq(ingestPublishedSlugs.kind, kind), inArray(ingestPublishedSlugs.slug, slugs)))
    return new Map(rows.map((r) => [r.alias, { slug: r.slug, name: (r.name || r.slug).slice(0, 255) }]))
  }

  async list(userId: string, limit: number): Promise<FavoriteRow[]> {
    const rows = await this.db
      .select({ kind: userFavorites.kind, slug: userFavorites.slug, canonical: ingestPublished.slug, name: userFavorites.name, favoritedAt: userFavorites.favoritedAt })
      .from(userFavorites)
      .leftJoin(ingestPublishedSlugs, and(eq(ingestPublishedSlugs.kind, userFavorites.kind), eq(ingestPublishedSlugs.slug, userFavorites.slug)))
      .leftJoin(ingestPublished, eq(ingestPublished.id, ingestPublishedSlugs.publishedId))
      .where(eq(userFavorites.userId, userId))
      .orderBy(desc(userFavorites.favoritedAt), desc(userFavorites.id))
      .limit(limit)
    return rows
  }

  async count(userId: string): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(userFavorites).where(eq(userFavorites.userId, userId))
    return Number(row?.n ?? 0)
  }

  async add(userId: string, kind: EntityKind, entity: ResolvedEntity, favoritedAt: Date): Promise<void> {
    await this.db.insert(userFavorites).values({ userId, kind, slug: entity.slug, name: entity.name, favoritedAt }).onDuplicateKeyUpdate({ set: { name: entity.name } })
  }

  async remove(userId: string, kind: EntityKind, slug: string): Promise<void> {
    // 同一个发布条目的所有地址：收藏之后条目被合并时，存下的可能是旧地址
    const aliases = this.db
      .select({ slug: sql`s2.slug` })
      .from(ingestPublishedSlugs)
      .innerJoin(sql`ingest_published_slugs s2`, sql`s2.published_id = ${ingestPublishedSlugs.publishedId}`)
      .where(and(eq(ingestPublishedSlugs.kind, kind), eq(ingestPublishedSlugs.slug, slug)))
    await this.db
      .delete(userFavorites)
      .where(and(eq(userFavorites.userId, userId), eq(userFavorites.kind, kind), or(eq(userFavorites.slug, slug), inArray(userFavorites.slug, aliases))))
  }
}
