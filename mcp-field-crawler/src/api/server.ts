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
import { MysqlCommentRepository } from './modules/comments/comment.repository.ts'
import { CommentService } from './modules/comments/comment.service.ts'
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

const app = createApp({
  entities,
  liveTools: new LiveToolsService(entities.server!, listRemoteTools),
  stats: new StatsService(new PublishedStatsReader(db)),
  field: new FieldService({ server: entities.server!, skill: entities.skill! }),
  tags: new TagService(new PublishedTagReader(db)),
  comments: new CommentService(new MysqlCommentRepository(db)),
  auth: config.supabaseUrl ? new SupabaseAuth(config.supabaseUrl) : undefined,
  logger,
  corsOrigins: config.corsOrigins,
  ping: async () => {
    await db.execute(sql`SELECT 1`)
  },
})

if (!config.supabaseUrl) logger.warn('没有设置 SUPABASE_URL，评论只能读取，不能发表')

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(`API 已启动：http://${config.host}:${info.port}/api/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`收到 ${signal}，正在关闭`)
    server.close(() => void pool.end().then(() => process.exit(0)))
  })
}
