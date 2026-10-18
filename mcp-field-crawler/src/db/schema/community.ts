import { bigint, index, mysqlTable, text, uniqueIndex, varchar, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { at, kindCol, pk, ref, timestamps } from './columns.ts'

/*
 * 社区层（community）：网站用户产生的数据（评论、认领），由 API 写入，采集任务不碰。
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

/**
 * MCP 服务认领：每个条目最多一行。通过 GitHub 验证是仓库所有者（个人仓库）或管理员 / 维护者（组织仓库）后写入，
 * 有效的认领让条目显示"已认证"。管理员撤销后保留这一行（revoked_at 有值），同一个 GitHub 账号不能再认领，换人认领时整行覆盖。
 */
export const entityClaims = mysqlTable(
  'entity_claims',
  {
    id: pk(),
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    /** 网站账号（Supabase Auth 的 UUID）和认领时的昵称、头像 */
    userId: varchar('user_id', { length: 36 }).notNull(),
    userName: varchar('user_name', { length: 100 }).notNull(),
    githubId: bigint('github_id', { mode: 'number', unsigned: true }).notNull(),
    githubLogin: varchar('github_login', { length: 100 }).notNull(),
    githubAvatar: varchar('github_avatar', { length: 512 }),
    /** 验证时 GitHub 返回的仓库全名 owner/name（仓库改过名时与条目记录的不同） */
    repoFullName: varchar('repo_full_name', { length: 255 }).notNull(),
    /** owner 个人仓库的所有者 / maintainer 组织仓库的管理员或维护者 */
    method: varchar('method', { length: 16 }).$type<'owner' | 'maintainer'>().notNull(),
    claimedAt: at('claimed_at').notNull(),
    revokedAt: at('revoked_at'),
    /** 撤销的后台账号 */
    revokedBy: varchar('revoked_by', { length: 64 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_entity_claims_target').on(t.kind, t.slug), index('ix_entity_claims_claimed').on(t.claimedAt)],
)
