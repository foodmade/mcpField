import { boolean, index, int, json, mediumtext, mysqlTable, smallint, timestamp, varchar } from 'drizzle-orm/mysql-core'
import type { BlogCategory, BlogMention, BlogStatus } from '../../blog/post.ts'
import { at, pk } from './columns.ts'

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
