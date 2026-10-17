import { z } from 'zod'
import type { R2Config } from '../assets/storage.ts'

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
  /** 博客图片上传到 R2（与图标同一个桶）：五项都配置了才能上传 */
  R2_ACCOUNT_ID: z.string().trim().optional(),
  R2_BUCKET: z.string().trim().optional(),
  R2_PUBLIC_BASE_URL: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
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
  r2?: R2Config
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
    r2:
      parsed.R2_ACCOUNT_ID && parsed.R2_BUCKET && parsed.R2_PUBLIC_BASE_URL && parsed.R2_ACCESS_KEY_ID && parsed.R2_SECRET_ACCESS_KEY
        ? { accountId: parsed.R2_ACCOUNT_ID, bucket: parsed.R2_BUCKET, publicBaseUrl: parsed.R2_PUBLIC_BASE_URL, accessKeyId: parsed.R2_ACCESS_KEY_ID, secretAccessKey: parsed.R2_SECRET_ACCESS_KEY }
        : undefined,
  }
}
