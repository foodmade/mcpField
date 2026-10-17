import { and, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { blogPosts, blogPostTranslations } from '../db/schema/index.ts'
import { submitUrls, type IndexNowConfig } from '../seo/indexnow.ts'

/*
 * 博客的 IndexNow 推送（Bing、Yandex 等；Google 不支持，只能靠 sitemap）：
 *   - 已发布、发布时间已到的文章，没推过或推送后又改过（indexnow_at 早于 updated_at）：推中文地址和博客列表页
 *   - 翻好的译文，没推过或推送后又重翻过（indexnow_at 早于 translated_at）：推对应语言的地址
 *   - 推过但现在看不到了的文章（撤回为草稿）：再推一次，让搜索引擎来抓到 404 后移除；删除文章时由后台直接调用 removed
 * 定时发布的文章到点后也会被扫到。由后台接口进程每分钟扫一遍，保存文章、译文翻好后立刻唤醒一次。
 */

const LOCALE_PREFIX: Record<string, string> = { zh: '', en: '/en', ja: '/ja' }

export const postUrl = (siteUrl: string, slug: string, locale = 'zh') => `${siteUrl}${LOCALE_PREFIX[locale] ?? `/${locale}`}/blog/${slug}`

export class BlogIndexNow {
  private timer: ReturnType<typeof setInterval> | undefined
  private running: Promise<void> | null = null
  private again = false

  constructor(
    private readonly db: Db,
    private readonly config: IndexNowConfig,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => this.kick(), intervalMs)
    this.timer.unref?.()
    this.kick()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  /** 唤醒一次；正在推送时，推完再扫一遍 */
  kick(): void {
    if (this.running) {
      this.again = true
      return
    }
    this.running = this.run()
      .then(() => undefined)
      .catch((error: unknown) => this.logger.warn({ err: (error as Error).message }, '博客 IndexNow 推送失败，下次再试'))
      .finally(() => {
        this.running = null
        if (this.again) {
          this.again = false
          this.kick()
        }
      })
  }

  /** 扫一遍要推送的地址并推送；推送成功才记下时间，失败时下次再推。返回推送的地址数 */
  async run(): Promise<number> {
    const now = this.now()
    const visible = and(eq(blogPosts.status, 'published'), lte(blogPosts.publishedAt, now))
    const [posts, translations, hidden] = await Promise.all([
      this.db
        .select({ id: blogPosts.id, slug: blogPosts.slug })
        .from(blogPosts)
        .where(and(visible, or(isNull(blogPosts.indexnowAt), lt(blogPosts.indexnowAt, blogPosts.updatedAt)))),
      this.db
        .select({ id: blogPostTranslations.id, slug: blogPosts.slug, locale: blogPostTranslations.locale })
        .from(blogPostTranslations)
        .innerJoin(blogPosts, eq(blogPosts.id, blogPostTranslations.postId))
        .where(and(visible, isNotNull(blogPostTranslations.contentHash), or(isNull(blogPostTranslations.indexnowAt), lt(blogPostTranslations.indexnowAt, blogPostTranslations.translatedAt)))),
      // 推过、但现在看不到了（撤回为草稿，或者改成了未来的发布时间）
      this.db
        .select({ id: blogPosts.id, slug: blogPosts.slug })
        .from(blogPosts)
        .where(and(isNotNull(blogPosts.indexnowAt), or(ne(blogPosts.status, 'published'), sql`${blogPosts.publishedAt} > ${now}`))),
    ])
    if (!posts.length && !translations.length && !hidden.length) return 0

    const hiddenLocales = hidden.length
      ? await this.db
          .select({ postId: blogPostTranslations.postId, locale: blogPostTranslations.locale })
          .from(blogPostTranslations)
          .where(and(inArray(blogPostTranslations.postId, hidden.map((h) => h.id)), isNotNull(blogPostTranslations.contentHash)))
      : []
    const site = this.config.siteUrl
    const urls = [
      ...posts.map((p) => postUrl(site, p.slug)),
      ...translations.map((t) => postUrl(site, t.slug, t.locale)),
      ...hidden.flatMap((h) => [postUrl(site, h.slug), ...hiddenLocales.filter((l) => l.postId === h.id).map((l) => postUrl(site, h.slug, l.locale))]),
    ]
    // 文章有增减或改动时，列表页也变了
    if (posts.length || hidden.length) urls.push(`${site}/blog`)
    await submitUrls([...new Set(urls)], this.config, this.fetchFn)

    if (posts.length) await this.db.update(blogPosts).set({ indexnowAt: now }).where(inArray(blogPosts.id, posts.map((p) => p.id)))
    if (translations.length) await this.db.update(blogPostTranslations).set({ indexnowAt: now }).where(inArray(blogPostTranslations.id, translations.map((t) => t.id)))
    // 看不到的文章推过一次就清掉时间：以后重新发布时当作新文章推送
    if (hidden.length) {
      await this.db.update(blogPosts).set({ indexnowAt: null }).where(inArray(blogPosts.id, hidden.map((h) => h.id)))
      await this.db.update(blogPostTranslations).set({ indexnowAt: null }).where(inArray(blogPostTranslations.postId, hidden.map((h) => h.id)))
    }
    this.logger.info({ urls: urls.length, posts: posts.map((p) => p.slug), translations: translations.map((t) => `${t.slug}:${t.locale}`), removed: hidden.map((h) => h.slug) }, '博客 IndexNow 推送完成')
    return urls.length
  }

  /** 删除文章前调用：推过的地址再推一次，让搜索引擎尽快移除 */
  async removed(postId: number): Promise<void> {
    const [post] = await this.db.select({ slug: blogPosts.slug, indexnowAt: blogPosts.indexnowAt }).from(blogPosts).where(eq(blogPosts.id, postId))
    if (!post?.indexnowAt) return
    const locales = await this.db
      .select({ locale: blogPostTranslations.locale })
      .from(blogPostTranslations)
      .where(and(eq(blogPostTranslations.postId, postId), isNotNull(blogPostTranslations.indexnowAt)))
    const urls = [postUrl(this.config.siteUrl, post.slug), ...locales.map((l) => postUrl(this.config.siteUrl, post.slug, l.locale)), `${this.config.siteUrl}/blog`]
    await submitUrls(urls, this.config, this.fetchFn).then(
      () => this.logger.info({ slug: post.slug, urls: urls.length }, '博客 IndexNow：已推送删除的文章'),
      (error: unknown) => this.logger.warn({ slug: post.slug, err: (error as Error).message }, '博客 IndexNow：推送删除的文章失败'),
    )
  }
}
