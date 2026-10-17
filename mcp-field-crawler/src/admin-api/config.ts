import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, '需要在 .env 中设置 DATABASE_URL'),
  ADMIN_API_PORT: z.coerce.number().int().min(1).max(65535).default(3200),
  /** 只接受本机请求：外部经 Nginx（admin.mcpfield.com）转发 */
  ADMIN_API_HOST: z.string().trim().default('127.0.0.1'),
  /** 后台页面的地址：改动类请求校验 Origin，只接受从这里发出的；逗号分隔 */
  ADMIN_ORIGINS: z.string().default('https://admin.mcpfield.com,http://localhost:5299'),
  /** 会话 cookie 是否只走 HTTPS：本地开发（http://localhost）设为 false */
  ADMIN_COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  SITE_URL: z.string().trim().default('https://mcpfield.com'),
  /** 日志目录：daily.log、run-<命令>.log（后台的运行日志页和手动运行用） */
  ADMIN_LOG_DIR: z.string().trim().default('logs'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

export interface AdminApiConfig {
  databaseUrl: string
  port: number
  host: string
  origins: string[]
  cookieSecure: boolean
  siteUrl: string
  logDir: string
  logLevel: string
}

export function loadAdminApiConfig(env: NodeJS.ProcessEnv = process.env): AdminApiConfig {
  const parsed = envSchema.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.ADMIN_API_PORT,
    host: parsed.ADMIN_API_HOST,
    origins: parsed.ADMIN_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    cookieSecure: parsed.ADMIN_COOKIE_SECURE === 'true',
    siteUrl: parsed.SITE_URL.replace(/\/+$/, ''),
    logDir: parsed.ADMIN_LOG_DIR,
    logLevel: parsed.LOG_LEVEL,
  }
}
