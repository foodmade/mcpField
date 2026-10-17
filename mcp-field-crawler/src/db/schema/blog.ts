import { boolean, index, int, json, mediumtext, mysqlTable, smallint, timestamp, tinyint, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'
import type { BlogCategory, BlogMention, BlogStatus, BlogTranslateLocale, BlogTranslationStatus } from '../../blog/post.ts'
import { at, localeCol, pk, ref, sha256, timestamps } from './columns.ts'

/*
 * 博客：文章在管理后台用 Markdown 撰写（admin-api 写），网站 API 只读已发布的。
 * 发布时间晚于现在的“已发布”文章是定时发布，到点前网站上看不到。
 */
export const blogPosts = mysqlTable(
  'blog_posts',
  {
    id: pk(),
    /** 网站地址 /blog/<slug> */
    slug: varchar('slug', { length: 120 }).notNull().unique('uq_blog_posts_slug'),
    title: varchar('title', { length: 200 }).notNull(),
    /** 列表和 SEO 描述用的摘要 */
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    /** Markdown 原文 */
    body: mediumtext('body').notNull(),
    category: varchar('category', { length: 24 }).$type<BlogCategory>().notNull(),
    tags: json('tags').$type<string[]>().notNull(),
    coverUrl: varchar('cover_url', { length: 1024 }),
    authorName: varchar('author_name', { length: 64 }).notNull(),
    /** draft 草稿 / published 已发布 */
    status: varchar('status', { length: 16 }).$type<BlogStatus>().notNull().default('draft'),
    /** 置顶：列表页第一篇大图展示 */
    pinned: boolean('pinned').notNull().default(false),
    /** 正文里链接到的站内条目，保存时从链接解析并带上名称、图标（见 blog/post.ts extractMentions） */
    mentions: json('mentions').$type<BlogMention[]>().notNull(),
    /** 预计阅读分钟数，保存时按正文字数算 */
    readingMinutes: smallint('reading_minutes', { unsigned: true }).notNull().default(1),
    views: int('views', { unsigned: true }).notNull().default(0),
    /** 第一次发布时填入，可以手动改（改到未来即定时发布） */
    publishedAt: at('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** 内容最后修改时间：由后台保存时写入，浏览数累加不改它 */
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [index('ix_blog_posts_status_published').on(t.status, t.publishedAt)],
)

/**
 * 文章译文：每篇 × 每种语言一行。中文是原文，发布（或已发布的文章修改）后后台把要翻的语言排进来，
 * 由后台接口进程里的翻译任务异步处理（见 blog/worker.ts）。
 * 译文字段保存最近一次翻译成功的结果（content_hash 是它对应的原文指纹）；原文再改时先继续显示旧译文，新译文翻完再替换。
 */
export const blogPostTranslations = mysqlTable(
  'blog_post_translations',
  {
    id: pk(),
    postId: ref('post_id').notNull().references(() => blogPosts.id, { onDelete: 'cascade' }),
    locale: localeCol().$type<BlogTranslateLocale>(),
    /** pending 排队 / running 翻译中 / done 已完成 / failed 多次失败 */
    status: varchar('status', { length: 16 }).$type<BlogTranslationStatus>().notNull().default('pending'),
    /** 要翻译的原文指纹（标题 + 摘要 + 正文） */
    targetHash: sha256('target_hash').notNull(),
    /** 当前译文对应的原文指纹；还没有译文时为空 */
    contentHash: sha256('content_hash'),
    title: varchar('title', { length: 400 }),
    summary: varchar('summary', { length: 1000 }),
    body: mediumtext('body'),
    /** 正文各片段的译文：片段指纹 → 译文。原文只改了几段时，没变的片段直接沿用 */
    chunks: json('chunks').$type<Record<string, string>>(),
    model: varchar('model', { length: 64 }),
    /** 最近一次失败的原因 */
    error: varchar('error', { length: 500 }),
    attempts: tinyint('attempts', { unsigned: true }).notNull().default(0),
    /** 失败后等到这个时间再重试 */
    nextAttemptAt: at('next_attempt_at'),
    startedAt: at('started_at'),
    translatedAt: at('translated_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_blog_post_translations').on(t.postId, t.locale), index('ix_blog_post_translations_queue').on(t.status, t.nextAttemptAt)],
)
