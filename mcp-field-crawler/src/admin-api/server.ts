import { serve } from '@hono/node-server'
import { R2Storage } from '../assets/storage.ts'
import { BlogTranslator } from '../blog/translate.ts'
import { BlogTranslationQueue, BlogTranslationWorker } from '../blog/worker.ts'
import { loadConfig } from '../config.ts'
import { translateLlmConfig } from '../llm/config.ts'
import { createLlm } from '../llm/provider.ts'
import { createDb } from '../db/client.ts'
import { createLogger } from '../infra/logger.ts'
import { AdminActions } from './actions.ts'
import { createAdminApp } from './app.ts'
import { AdminAuth } from './auth.ts'
import { loadAdminApiConfig } from './config.ts'

/* 管理后台接口的组合根：和网站 API 分开的进程（pm2 mcpfield-admin-api），只监听本机 */

const config = loadAdminApiConfig()
const logger = createLogger(config.logLevel)
const { db, pool } = createDb(config.databaseUrl)

/*
 * 博客翻译任务：跑在这个进程里，保存已发布文章后立刻唤醒，另外每分钟扫一遍队列（失败重试、重启前没做完的）。
 * 模型服务用和 README 翻译相同的配置（TRANSLATE_PROVIDER、README_MODEL）；没配置时只排队，后台提示没有翻译模型
 */
const queue = new BlogTranslationQueue(db)
let worker: BlogTranslationWorker | undefined
try {
  const appConfig = loadConfig()
  const translator = new BlogTranslator(createLlm({ ...translateLlmConfig(appConfig), timeoutMs: 180_000, maxRetries: 2 }), appConfig.readmeModel, logger)
  worker = new BlogTranslationWorker(queue, translator, logger)
} catch (error) {
  logger.warn({ err: (error as Error).message }, '没有可用的翻译模型服务，博客译文只排队、不翻译')
}

const app = createAdminApp({
  db,
  auth: new AdminAuth(db),
  actions: new AdminActions(config.logDir),
  logger,
  origins: config.origins,
  cookieSecure: config.cookieSecure,
  siteUrl: config.siteUrl,
  storage: config.r2 ? new R2Storage(config.r2) : undefined,
  blogTranslations: { queue, kick: () => worker?.kick(), enabled: !!worker },
})

void worker?.start().catch((error: unknown) => logger.error({ err: (error as Error).message }, '博客翻译任务启动失败'))

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(`后台接口已启动：http://${config.host}:${info.port}/api/admin/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`收到 ${signal}，正在关闭`)
    worker?.stop()
    server.close(() => void pool.end().then(() => process.exit(0)))
  })
}
