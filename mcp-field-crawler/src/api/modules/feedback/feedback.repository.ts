import { and, count, eq, gte, or, type SQL } from 'drizzle-orm'
import type { EntityKind } from '../../../core/types.ts'
import type { Db } from '../../../db/client.ts'
import { feedback, ingestPublished, ingestPublishedSlugs } from '../../../db/schema/index.ts'

export const FEEDBACK_TYPES = ['wrong_info', 'broken_link', 'install', 'duplicate', 'suggestion', 'other'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export interface NewFeedback {
  kind: EntityKind
  slug: string
  type: FeedbackType
  body: string
  email: string | null
  userId: string | null
  userName: string | null
  ipHash: string | null
}

export interface FeedbackRepository {
  /** 条目的正式 slug；旧地址也能找到；条目不存在时返回 null */
  resolveSlug(kind: EntityKind, slug: string): Promise<string | null>
  insert(row: NewFeedback): Promise<void>
  /** 同一账号或同一 IP 从某个时间起提交的反馈数（限流用） */
  postedSince(by: { userId: string | null; ipHash: string | null }, since: Date): Promise<number>
}

export class MysqlFeedbackRepository implements FeedbackRepository {
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

  async insert(row: NewFeedback): Promise<void> {
    await this.db.insert(feedback).values(row)
  }

  async postedSince(by: { userId: string | null; ipHash: string | null }, since: Date): Promise<number> {
    const who: SQL[] = []
    if (by.userId) who.push(eq(feedback.userId, by.userId))
    if (by.ipHash) who.push(eq(feedback.ipHash, by.ipHash))
    if (!who.length) return 0
    const [row] = await this.db
      .select({ n: count() })
      .from(feedback)
      .where(and(or(...who), gte(feedback.createdAt, since)))
    return Number(row?.n ?? 0)
  }
}
