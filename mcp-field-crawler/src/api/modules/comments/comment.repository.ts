import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import type { EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { commentReactions, comments, ingestPublished, ingestPublishedSlugs } from '../../../db/schema/index.ts'

export const REACTIONS = ['up', 'party', 'heart', 'rocket'] as const
export type Reaction = (typeof REACTIONS)[number]
export const COMMENT_SORTS = ['newest', 'oldest', 'top'] as const
export type CommentSort = (typeof COMMENT_SORTS)[number]

export interface CommentRow {
  id: number
  kind: EntityKind
  slug: string
  parentId: number | null
  userId: string
  authorName: string
  authorAvatar: string | null
  body: string
  createdAt: Date
}

export type NewComment = Omit<CommentRow, 'id' | 'createdAt'>

export interface CommentRepository {
  /** 条目的正式 slug；旧地址（被合并条目的 slug）也能找到；条目不存在时返回 null */
  resolveSlug(kind: EntityKind, slug: string): Promise<string | null>
  /** 一页顶层评论，以及顶层评论数（total）和含回复的总数（count） */
  page(kind: EntityKind, slug: string, sort: CommentSort, offset: number, limit: number): Promise<{ rows: CommentRow[]; total: number; count: number }>
  replies(parentIds: number[]): Promise<CommentRow[]>
  /** 各评论每种回应的人数 */
  reactionCounts(ids: number[]): Promise<{ commentId: number; reaction: Reaction; n: number }[]>
  /** 某人在这些评论上点过的回应 */
  reactionsBy(ids: number[], userId: string): Promise<{ commentId: number; reaction: Reaction }[]>
  find(id: number): Promise<CommentRow | null>
  insert(row: NewComment): Promise<CommentRow>
  /** 删除评论，回复和回应由外键级联删除 */
  remove(id: number): Promise<void>
  /** 某人从某个时间起发表的评论数（限流用） */
  postedSince(userId: string, since: Date): Promise<number>
  setReaction(commentId: number, userId: string, reaction: Reaction, on: boolean): Promise<void>
}

const COLUMNS = {
  id: comments.id,
  kind: comments.kind,
  slug: comments.slug,
  parentId: comments.parentId,
  userId: comments.userId,
  authorName: comments.authorName,
  authorAvatar: comments.authorAvatar,
  body: comments.body,
  createdAt: comments.createdAt,
}

/** 最热：回应数 + 回复数 */
const SCORE = sql`(SELECT COUNT(*) FROM ${commentReactions} WHERE ${commentReactions.commentId} = ${comments.id}) + (SELECT COUNT(*) FROM ${comments} r WHERE r.parent_id = ${comments.id})`

const ORDER: Record<CommentSort, ReturnType<typeof desc>[]> = {
  newest: [desc(comments.id)],
  oldest: [asc(comments.id)],
  top: [desc(SCORE), desc(comments.id)],
}

export class MysqlCommentRepository implements CommentRepository {
  constructor(private readonly db: Db) {}

  async resolveSlug(kind: EntityKind, slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ slug: ingestPublished.slug })
      .from(ingestPublishedSlugs)
      .innerJoin(ingestPublished, eq(ingestPublished.id, ingestPublishedSlugs.publishedId))
      .where(and(eq(ingestPublishedSlugs.kind, kind), eq(ingestPublishedSlugs.slug, slug)))
      .limit(1)
    return row?.slug ?? null
  }

  async page(kind: EntityKind, slug: string, sort: CommentSort, offset: number, limit: number) {
    const target = and(eq(comments.kind, kind), eq(comments.slug, slug))
    const [rows, [totals]] = await Promise.all([
      this.db.select(COLUMNS).from(comments).where(and(target, isNull(comments.parentId))).orderBy(...ORDER[sort]).limit(limit).offset(offset),
      this.db.select({ count: count(), total: sql<number>`SUM(${comments.parentId} IS NULL)` }).from(comments).where(target),
    ])
    return { rows: rows as CommentRow[], total: Number(totals?.total ?? 0), count: Number(totals?.count ?? 0) }
  }

  async replies(parentIds: number[]): Promise<CommentRow[]> {
    if (parentIds.length === 0) return []
    return (await this.db.select(COLUMNS).from(comments).where(inArray(comments.parentId, parentIds)).orderBy(asc(comments.id))) as CommentRow[]
  }

  async reactionCounts(ids: number[]) {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ commentId: commentReactions.commentId, reaction: commentReactions.reaction, n: count() })
      .from(commentReactions)
      .where(inArray(commentReactions.commentId, ids))
      .groupBy(commentReactions.commentId, commentReactions.reaction)
    return rows as { commentId: number; reaction: Reaction; n: number }[]
  }

  async reactionsBy(ids: number[], userId: string) {
    if (ids.length === 0) return []
    const rows = await this.db
      .select({ commentId: commentReactions.commentId, reaction: commentReactions.reaction })
      .from(commentReactions)
      .where(and(inArray(commentReactions.commentId, ids), eq(commentReactions.userId, userId)))
    return rows as { commentId: number; reaction: Reaction }[]
  }

  async find(id: number): Promise<CommentRow | null> {
    const [row] = await this.db.select(COLUMNS).from(comments).where(eq(comments.id, id)).limit(1)
    return (row as CommentRow | undefined) ?? null
  }

  async insert(row: NewComment): Promise<CommentRow> {
    const [inserted] = await this.db.insert(comments).values(row).$returningId()
    return (await this.find(inserted!.id))!
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(comments).where(eq(comments.id, id))
  }

  async postedSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(comments).where(and(eq(comments.userId, userId), gte(comments.createdAt, since)))
    return Number(row?.n ?? 0)
  }

  async setReaction(commentId: number, userId: string, reaction: Reaction, on: boolean): Promise<void> {
    if (on) {
      await this.db.insert(commentReactions).values({ commentId, userId, reaction }).onDuplicateKeyUpdate({ set: { reaction } })
    } else {
      await this.db.delete(commentReactions).where(and(eq(commentReactions.commentId, commentId), eq(commentReactions.userId, userId), eq(commentReactions.reaction, reaction)))
    }
  }
}
