import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { blogPosts, blogPostTranslations } from '../db/schema/index.ts'
import { BLOG_TRANSLATE_LOCALES, blogSourceHash, type BlogTranslateLocale, type BlogTranslationStatus } from './post.ts'
import type { BlogTranslator } from './translate.ts'

/*
 * 博客翻译队列：表 blog_post_translations 就是队列（每篇 × 每种语言一行）。
 * 后台保存已发布的文章时调用 enqueue 把原文有变化的语言排进来，BlogTranslationWorker 在后台接口进程里逐个处理：
 * 保存后立刻唤醒一次，另外每分钟扫一遍（失败后到点重试、进程重启前没做完的）。整个系统只有这一个 worker，不需要分布式锁。
 */

/** 失败后的重试间隔：第 1、2 次失败后分别等 2 分钟、10 分钟，第 3 次失败标记为 failed，等人工点“重新翻译” */
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000]
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

export interface BlogTranslationState {
  locale: BlogTranslateLocale
  status: BlogTranslationStatus
  /** 有译文，但对应的是旧版原文（新译文还没翻完） */
  outdated: boolean
  hasContent: boolean
  error: string | null
  attempts: number
  model: string | null
  translatedAt: string | null
  nextAttemptAt: string | null
}

export class BlogTranslationQueue {
  constructor(private readonly db: Db) {}

  /**
   * 把需要翻译的语言排进队列：没有译文的、原文变了的、之前失败的；force 时不管有没有变化都重翻。
   * 原文没变且已经翻好（或正在翻同一版）的语言不动。返回排进来的语言。
   */
  async enqueue(postId: number, hash: string, options: { force?: boolean; locales?: readonly BlogTranslateLocale[] } = {}): Promise<BlogTranslateLocale[]> {
    const locales = options.locales ?? BLOG_TRANSLATE_LOCALES
    const rows = await this.db.select().from(blogPostTranslations).where(eq(blogPostTranslations.postId, postId))
    const byLocale = new Map(rows.map((r) => [r.locale, r]))
    const queued: BlogTranslateLocale[] = []
    for (const locale of locales) {
      const row = byLocale.get(locale)
      const reset = { status: 'pending' as const, targetHash: hash, attempts: 0, error: null, nextAttemptAt: null }
      if (!row) {
        await this.db.insert(blogPostTranslations).values({ postId, locale, ...reset }).onDuplicateKeyUpdate({ set: reset })
        queued.push(locale)
        continue
      }
      const current = row.targetHash === hash && row.status !== 'failed'
      if (current && !options.force) continue
      // force 时清掉片段缓存，所有片段重新翻
      await this.db
        .update(blogPostTranslations)
        .set({ ...reset, ...(options.force ? { chunks: null } : {}) })
        .where(eq(blogPostTranslations.id, row.id))
      queued.push(locale)
    }
    return queued
  }

  /** 后台显示用：各篇各语言的翻译状态。hash 是文章当前的原文指纹；不传时（列表页不取正文）和最近一次排队的指纹比 */
  async states(posts: { id: number; hash?: string }[]): Promise<Map<number, BlogTranslationState[]>> {
    const map = new Map<number, BlogTranslationState[]>()
    if (!posts.length) return map
    const hashOf = new Map(posts.map((p) => [p.id, p.hash]))
    const rows = await this.db
      .select({
        postId: blogPostTranslations.postId,
        locale: blogPostTranslations.locale,
        status: blogPostTranslations.status,
        contentHash: blogPostTranslations.contentHash,
        targetHash: blogPostTranslations.targetHash,
        error: blogPostTranslations.error,
        attempts: blogPostTranslations.attempts,
        model: blogPostTranslations.model,
        translatedAt: blogPostTranslations.translatedAt,
        nextAttemptAt: blogPostTranslations.nextAttemptAt,
      })
      .from(blogPostTranslations)
      .where(inArray(blogPostTranslations.postId, posts.map((p) => p.id)))
    for (const r of rows) {
      const list = map.get(r.postId) ?? []
      list.push({
        locale: r.locale,
        status: r.status,
        outdated: !!r.contentHash && r.contentHash !== (hashOf.get(r.postId) ?? r.targetHash),
        hasContent: !!r.contentHash,
        error: r.error,
        attempts: r.attempts,
        model: r.model,
        translatedAt: r.translatedAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
      })
      map.set(r.postId, list)
    }
    return map
  }

  /** 已发布但某种语言从没排过队的文章（例如翻译功能上线前发布的）：补排进来，返回排进来的篇数 */
  async enqueueMissing(): Promise<number> {
    const rows = await this.db
      .select({ id: blogPosts.id, title: blogPosts.title, summary: blogPosts.summary, body: blogPosts.body, have: sql<number>`(SELECT COUNT(*) FROM blog_post_translations t WHERE t.post_id = ${blogPosts.id})` })
      .from(blogPosts)
      .where(eq(blogPosts.status, 'published'))
    let n = 0
    for (const r of rows) {
      if (Number(r.have) >= BLOG_TRANSLATE_LOCALES.length) continue
      const queued = await this.enqueue(r.id, blogSourceHash(r))
      if (queued.length) n++
    }
    return n
  }

  /** 进程重启前没做完的（停在 running）放回队列 */
  async requeueInterrupted(): Promise<number> {
    const [result] = await this.db.update(blogPostTranslations).set({ status: 'pending' }).where(eq(blogPostTranslations.status, 'running'))
    return (result as { affectedRows?: number }).affectedRows ?? 0
  }

  /** 取出下一条到点的任务并标记为 running；没有时返回 null */
  async claim(now: Date) {
    const [next] = await this.db
      .select({ id: blogPostTranslations.id })
      .from(blogPostTranslations)
      .where(and(eq(blogPostTranslations.status, 'pending'), or(isNull(blogPostTranslations.nextAttemptAt), lte(blogPostTranslations.nextAttemptAt, now))))
      .orderBy(asc(blogPostTranslations.id))
      .limit(1)
    if (!next) return null
    const [result] = await this.db
      .update(blogPostTranslations)
      .set({ status: 'running', startedAt: now })
      .where(and(eq(blogPostTranslations.id, next.id), eq(blogPostTranslations.status, 'pending')))
    if ((result as { affectedRows?: number }).affectedRows !== 1) return null
    const [row] = await this.db.select().from(blogPostTranslations).where(eq(blogPostTranslations.id, next.id))
    return row ? { ...row, chunks: json<Record<string, string> | null>(row.chunks) } : null
  }

  /**
   * 保存译文。翻译期间原文又改过（target_hash 已经换成新的）时，先保存这版译文，状态放回 pending 接着翻新版
   */
  async complete(id: number, hash: string, result: { title: string; summary: string; body: string; chunks: Record<string, string>; model: string }, now: Date): Promise<void> {
    await this.db
      .update(blogPostTranslations)
      .set({
        ...result,
        contentHash: hash,
        status: sql`IF(${blogPostTranslations.targetHash} = ${hash}, 'done', 'pending')`,
        attempts: 0,
        error: null,
        nextAttemptAt: null,
        translatedAt: now,
      })
      .where(eq(blogPostTranslations.id, id))
  }

  /** 记一次失败：没到次数上限的过一会儿重试 */
  async fail(id: number, attempts: number, error: string, now: Date): Promise<BlogTranslationStatus> {
    const n = attempts + 1
    const status: BlogTranslationStatus = n >= MAX_ATTEMPTS ? 'failed' : 'pending'
    await this.db
      .update(blogPostTranslations)
      .set({ status, attempts: n, error: error.slice(0, 500), nextAttemptAt: status === 'pending' ? new Date(now.getTime() + RETRY_DELAYS_MS[n - 1]!) : null })
      .where(eq(blogPostTranslations.id, id))
    return status
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(blogPostTranslations).where(eq(blogPostTranslations.id, id))
  }

  async source(postId: number) {
    const [post] = await this.db.select({ title: blogPosts.title, summary: blogPosts.summary, body: blogPosts.body, slug: blogPosts.slug }).from(blogPosts).where(eq(blogPosts.id, postId))
    return post ?? null
  }
}

/** 在后台接口进程里逐个处理翻译任务；同一时间只处理一条 */
export class BlogTranslationWorker {
  private timer: ReturnType<typeof setInterval> | undefined
  private draining: Promise<void> | null = null
  private again = false
  private readonly controller = new AbortController()

  constructor(
    private readonly queue: BlogTranslationQueue,
    private readonly translator: BlogTranslator,
    private readonly logger: Logger,
    private readonly intervalMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    const n = await this.queue.requeueInterrupted()
    if (n) this.logger.info({ count: n }, '上次没翻完的博客译文放回队列')
    const missing = await this.queue.enqueueMissing()
    if (missing) this.logger.info({ posts: missing }, '已发布但还没翻译的博客文章排进翻译队列')
    this.timer = setInterval(() => this.kick(), this.intervalMs)
    this.timer.unref?.()
    this.kick()
  }

  /** 关闭时中断进行中的请求；没做完的那条下次启动时放回队列 */
  stop(): void {
    clearInterval(this.timer)
    this.controller.abort()
  }

  /** 有新任务时唤醒：正在处理时，处理完当前这批再扫一遍 */
  kick(): void {
    if (this.draining) {
      this.again = true
      return
    }
    this.draining = this.drain()
      .catch((error: unknown) => this.logger.error({ err: (error as Error).message }, '博客翻译队列出错'))
      .finally(() => {
        this.draining = null
        if (this.again) {
          this.again = false
          this.kick()
        }
      })
  }

  /** 处理到队列里没有到点的任务为止（测试里等它结束） */
  async drain(): Promise<void> {
    for (let task = await this.queue.claim(this.now()); task && !this.controller.signal.aborted; task = await this.queue.claim(this.now())) {
      await this.process(task)
    }
  }

  private async process(task: NonNullable<Awaited<ReturnType<BlogTranslationQueue['claim']>>>): Promise<void> {
    const post = await this.queue.source(task.postId)
    if (!post) return this.queue.remove(task.id)
    const hash = blogSourceHash(post)
    const started = Date.now()
    try {
      const result = await this.translator.translate(post, task.locale, task.chunks ?? {}, this.controller.signal)
      await this.queue.complete(task.id, hash, { title: result.title, summary: result.summary, body: result.body, chunks: result.chunks, model: this.translator.model }, this.now())
      this.logger.info({ slug: post.slug, locale: task.locale, translatedChunks: result.translatedChunks, reusedChunks: Object.keys(result.chunks).length - result.translatedChunks, seconds: Math.round((Date.now() - started) / 1000) }, '博客译文已保存')
    } catch (error) {
      if (this.controller.signal.aborted) return
      const message = (error as Error).message
      const status = await this.queue.fail(task.id, task.attempts, message, this.now())
      this.logger.warn({ slug: post.slug, locale: task.locale, attempt: task.attempts + 1, status, err: message }, status === 'failed' ? '博客翻译多次失败，等人工重新翻译' : '博客翻译失败，稍后重试')
    }
  }
}
