import { bigint, index, mysqlTable, text, uniqueIndex, varchar, type AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { at, kindCol, pk, ref, sha256, timestamps } from './columns.ts'

/*
 * 社区层（community）：网站用户产生的数据（评论、认领、反馈、收藏、API 密钥），由 API 写入，采集任务不碰。
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

/**
 * 详情页的问题反馈：不用登录也能提交；登录了的记下账号。只有后台能看，管理员处理后标记为已处理或忽略。
 * 不存 IP 原文，只存它的 SHA-256（按 IP 限流用）。
 */
export const feedback = mysqlTable(
  'feedback',
  {
    id: pk(),
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    /** wrong_info 信息有误 / broken_link 链接失效 / install 安装配置不能用 / duplicate 重复收录 / suggestion 功能建议 / other 其他 */
    type: varchar('type', { length: 16 }).notNull(),
    body: text('body').notNull(),
    /** 未登录时选填的联系邮箱 */
    email: varchar('email', { length: 255 }),
    /** 登录了的网站账号（Supabase Auth 的 UUID）和当时的昵称 */
    userId: varchar('user_id', { length: 36 }),
    userName: varchar('user_name', { length: 100 }),
    ipHash: sha256('ip_hash'),
    /** open 待处理 / resolved 已处理 / ignored 忽略 */
    status: varchar('status', { length: 16 }).notNull().default('open'),
    handledAt: at('handled_at'),
    /** 处理的后台账号 */
    handledBy: varchar('handled_by', { length: 64 }),
    ...timestamps(),
  },
  (t) => [index('ix_feedback_status').on(t.status, t.id), index('ix_feedback_target').on(t.kind, t.slug), index('ix_feedback_ip_created').on(t.ipHash, t.createdAt)],
)

/**
 * 收藏：网站用户在详情页收藏的 MCP 服务和 Skill，控制台「我的收藏」列出。每人对每个条目最多一行。
 * slug 存收藏时的正式地址；条目之后被合并时，读取时经 ingest_published_slugs 找到代表条目。
 * name 是收藏时的名称：条目下架后列表里仍能显示它是什么。favorited_at 是收藏时间（撤销取消收藏时恢复原值）。
 */
export const userFavorites = mysqlTable(
  'user_favorites',
  {
    id: pk(),
    /** 网站账号（Supabase Auth 的 UUID） */
    userId: varchar('user_id', { length: 36 }).notNull(),
    kind: kindCol(),
    slug: varchar('slug', { length: 191 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    favoritedAt: at('favorited_at').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_user_favorites').on(t.userId, t.kind, t.slug), index('ix_user_favorites_user_time').on(t.userId, t.favoritedAt)],
)

/**
 * API 密钥：给 MCP Field 的 MCP 服务（npm 包 mcpfield-mcp）用，Agent 通过它代表用户读写收藏。
 * 只存密钥的 SHA-256；hint_prefix / hint_suffix 是 mf_ 之后的前 4 位和最后 4 位，列表里用来辨认。
 * 撤销即删除这一行；过期的保留，等用户自己删。第一版不分权限，密钥能做用户对收藏能做的所有操作。
 */
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: pk(),
    /** 网站账号（Supabase Auth 的 UUID） */
    userId: varchar('user_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    keyHash: sha256('key_hash').notNull(),
    hintPrefix: varchar('hint_prefix', { length: 8 }).notNull(),
    hintSuffix: varchar('hint_suffix', { length: 8 }).notNull(),
    /** 为空表示永不过期 */
    expiresAt: at('expires_at'),
    lastUsedAt: at('last_used_at'),
    /** 最近一次使用的客户端：MCP 握手时 Agent 报上来的名称（如 claude-code） */
    lastUsedClient: varchar('last_used_client', { length: 64 }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_api_keys_hash').on(t.keyHash), index('ix_api_keys_user').on(t.userId, t.id)],
)
