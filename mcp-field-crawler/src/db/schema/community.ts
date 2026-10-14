import { index, mysqlTable, text, uniqueIndex, varchar, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { kindCol, pk, ref, timestamps } from './columns.ts'

/*
 * 社区层（community）：网站用户产生的数据，由 API 写入，采集任务不碰。
 * 评论按 类型 + slug 关联条目，不加外键：发布表每次 publish 整体重建，slug 会沿用，但行 id 会变。
 * 用户是 Supabase Auth 的账号（user_id 为其 UUID），昵称和头像在发表时从登录令牌里取一份存下来。
 */

/** 评论：parent_id 为空的是顶层评论，回复只有一层；删除顶层评论时回复一起删除 */
export const comments = mysqlTable(
  'comments',
  {
    id: pk(),
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    parentId: ref('parent_id').references((): AnyMySqlColumn => comments.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 36 }).notNull(),
    authorName: varchar('author_name', { length: 100 }).notNull(),
    authorAvatar: varchar('author_avatar', { length: 512 }),
    /** Markdown 原文 */
    body: text('body').notNull(),
    ...timestamps(),
  },
  (t) => [
    index('ix_comments_target').on(t.kind, t.slug, t.parentId, t.id),
    index('ix_comments_parent').on(t.parentId),
    index('ix_comments_user_created').on(t.userId, t.createdAt),
  ],
)

/** 表情回应：每人对每条评论的每种回应最多一次 */
export const commentReactions = mysqlTable(
  'comment_reactions',
  {
    id: pk(),
    commentId: ref('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 36 }).notNull(),
    /** up / party / heart / rocket */
    reaction: varchar('reaction', { length: 16 }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_comment_reactions').on(t.commentId, t.userId, t.reaction)],
)
