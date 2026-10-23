import { serve } from '@hono/node-server'
import { sql } from 'drizzle-orm'
import { ENTITY_KINDS, type EntityKind } from '../core/types.ts'
import { createDb } from '../db/client.ts'
import { createLogger } from '../infra/logger.ts'
import { OverviewStore } from '../overview/store.ts'
import { ReadmeTranslationStore } from '../readme/store.ts'
import { AssetStore } from '../assets/store.ts'
import { DescribeStore } from '../describe/store.ts'
import { GithubReadmeStore, GithubRepoStore } from '../github/store.ts'
import { TranslationMemory } from '../translate/memory.ts'
import { createApp, type ApiDeps } from './app.ts'
import { SupabaseAuth } from './auth/supabase-auth.ts'
import { loadApiConfig } from './config.ts'
import { listRemoteTools } from '../probe/mcp-remote.ts'
import { MysqlBlogRepository } from './modules/blog/blog.repository.ts'
import { BlogService } from './modules/blog/blog.service.ts'
import { MysqlClaimRepository } from './modules/claims/claim.repository.ts'
import { ClaimService } from './modules/claims/claim.service.ts'
import { GithubOAuthApp } from './modules/claims/github-oauth.ts'
import { MysqlCommentRepository } from './modules/comments/comment.repository.ts'
import { CommentService } from './modules/comments/comment.service.ts'
import { MysqlFavoriteRepository } from './modules/favorites/favorite.repository.ts'
import { FavoriteService } from './modules/favorites/favorite.service.ts'
import { MysqlFeedbackRepository } from './modules/feedback/feedback.repository.ts'
import { MysqlApiKeyRepository } from './modules/keys/key.repository.ts'
import { ApiKeyService } from './modules/keys/key.service.ts'
import { AnalyticsCollector } from '../analytics/collector.ts'
import { FeedbackService } from './modules/feedback/feedback.service.ts'
import { EntityService } from './modules/entities/entity.service.ts'
import { LiveToolsService } from './modules/entities/live-tools.ts'
import { PRESENTERS } from './modules/entities/presenters.ts'
import { FieldService } from './modules/stats/field.service.ts'
import { PublishedStatsReader, StatsService } from './modules/stats/stats.service.ts'
import { PublishedTagReader, TagService } from './modules/tags/tag.service.ts'
import { DraftEntityRepository } from './repositories/draft-entity.repository.ts'

/* API 的组合根：装配数据库、仓储、业务服务，启动 HTTP 服务 */

const config = loadApiConfig()
const logger = createLogger(config.logLevel)
const { db, pool } = createDb(config.databaseUrl)

const overviews = new OverviewStore(db)
const localization = {
  translations: new TranslationMemory(db),
  overviews,
  readmes: new ReadmeTranslationStore(db),
  assets: new AssetStore(db),
  generated: new DescribeStore(db, overviews),
  githubReadmes: new GithubReadmeStore(db),
  githubRepos: new GithubRepoStore(db),
}

/** 列表、目录计数缓存 10 分钟（与首页统计一致）；每种类型最多 200 条列表结果，单条一般几十 KB */
const RESULT_CACHE = { ttlMs: 10 * 60_000, maxLists: 200 }

function serviceFor<K extends EntityKind>(kind: K): EntityService<K> {
  const presenter = PRESENTERS[kind]
  return new EntityService(kind, new DraftEntityRepository(db, kind, { popularMetric: presenter.popularMetric, typePath: presenter.typePath }), presenter, localization, RESULT_CACHE)
}

const entities: ApiDeps['entities'] = {}
for (const kind of ENTITY_KINDS) (entities as Record<EntityKind, EntityService<EntityKind>>)[kind] = serviceFor(kind)

/* 访问统计：页面浏览先进内存，每 5 秒批量写库；关闭时把剩下的写完 */
const analytics = new AnalyticsCollector(db, new URL(config.siteUrl).hostname.replace(/^www\./, ''), logger)
analytics.start()

const githubClaim = config.githubClaim && new GithubOAuthApp({ ...config.githubClaim, callbackUrl: `${config.siteUrl}/api/claims/github/callback` })

const app = createApp({
  entities,
  liveTools: new LiveToolsService(entities.server!, listRemoteTools),
  stats: new StatsService(new PublishedStatsReader(db)),
  field: new FieldService({ server: entities.server!, skill: entities.skill! }),
  tags: new TagService(new PublishedTagReader(db)),
  comments: new CommentService(new MysqlCommentRepository(db)),
  favorites: new FavoriteService(new MysqlFavoriteRepository(db), (kind, slugs, locale) => entities[kind]!.listBySlugs(slugs, locale)),
  apiKeys: new ApiKeyService(new MysqlApiKeyRepository(db)),
  feedback: new FeedbackService(new MysqlFeedbackRepository(db)),
  blog: new BlogService(new MysqlBlogRepository(db)),
  analytics,
  claims: new ClaimService(new MysqlClaimRepository(db), githubClaim ?? null, config.githubClaim?.clientSecret ?? null, logger),
  cookieSecure: config.siteUrl.startsWith('https://'),
  auth: config.supabaseUrl ? new SupabaseAuth(config.supabaseUrl) : undefined,
  logger,
  corsOrigins: config.corsOrigins,
  ping: async () => {
    await db.execute(sql`SELECT 1`)
  },
})

if (!config.supabaseUrl) logger.warn('没有设置 SUPABASE_URL，评论只能读取，不能发表')
if (!config.githubClaim) logger.warn('没有设置 GITHUB_CLAIM_CLIENT_ID / GITHUB_CLAIM_CLIENT_SECRET，MCP 服务不能认领')

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(`API 已启动：http://${config.host}:${info.port}/api/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`收到 ${signal}，正在关闭`)
    server.close(() => void analytics.stop().finally(() => pool.end().then(() => process.exit(0))))
  })
}
