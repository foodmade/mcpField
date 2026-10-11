import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, '需要在 .env 中设置 DATABASE_URL'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  /** 监听地址：默认只接受本机请求（浏览器经前端服务的 /api 反向代理访问） */
  API_HOST: z.string().trim().default('127.0.0.1'),
  /** 允许跨域访问的前端地址，逗号分隔 */
  API_CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5288'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

export interface ApiConfig {
  databaseUrl: string
  port: number
  host: string
  corsOrigins: string[]
  logLevel: string
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = envSchema.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.API_PORT,
    host: parsed.API_HOST,
    corsOrigins: parsed.API_CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    logLevel: parsed.LOG_LEVEL,
  }
}
