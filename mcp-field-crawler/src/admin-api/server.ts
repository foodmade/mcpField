import { serve } from '@hono/node-server'
import { R2Storage } from '../assets/storage.ts'
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

const app = createAdminApp({
  db,
  auth: new AdminAuth(db),
  actions: new AdminActions(config.logDir),
  logger,
  origins: config.origins,
  cookieSecure: config.cookieSecure,
  siteUrl: config.siteUrl,
  storage: config.r2 ? new R2Storage(config.r2) : undefined,
})

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  logger.info(`后台接口已启动：http://${config.host}:${info.port}/api/admin/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info(`收到 ${signal}，正在关闭`)
    server.close(() => void pool.end().then(() => process.exit(0)))
  })
}
