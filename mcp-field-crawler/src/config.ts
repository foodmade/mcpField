import { z } from 'zod'

const optionalString = z
  .string()
  .trim()
  .transform((v) => v || undefined)
  .optional()

const envSchema = z.object({
  DATABASE_URL: optionalString,
  CRAWLER_USER_AGENT: z.string().trim().min(1).default('MCPFieldBot/0.1 (+https://mcpfield.dev/bot)'),
  DATA_DIR: z.string().trim().default('./data'),
  GITHUB_TOKEN: optionalString,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_BASE_URL: optionalString,
  TRANSLATE_MODEL: z.string().trim().default('claude-haiku-4-5-20251001'),
  OVERVIEW_MODEL: z.string().trim().default('claude-haiku-4-5-20251001'),
  /** 热门项目用的模型 */
  OVERVIEW_PREMIUM_MODEL: z.string().trim().default('claude-sonnet-5-5'),
  README_MODEL: z.string().trim().default('claude-haiku-4-5-20251001'),
  README_PREMIUM_MODEL: z.string().trim().default('claude-sonnet-5-5'),
  /** Loop 内容要写步骤，用更强的模型；CLI / Agent 用快速模型 */
  DESCRIBE_LOOP_MODEL: z.string().trim().default('claude-sonnet-5-5'),
  DESCRIBE_MODEL: z.string().trim().default('claude-haiku-4-5-20251001'),
  R2_ACCOUNT_ID: optionalString,
  R2_BUCKET: optionalString,
  R2_PUBLIC_BASE_URL: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
})

export interface AppConfig {
  databaseUrl?: string
  userAgent: string
  dataDir: string
  githubToken?: string
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  anthropic: { apiKey?: string; baseURL?: string }
  translateModel: string
  overviewModel: string
  overviewPremiumModel: string
  readmeModel: string
  readmePremiumModel: string
  describeLoopModel: string
  describeModel: string
  /** 五项都配置了才启用 R2 */
  r2?: { accountId: string; bucket: string; publicBaseUrl: string; accessKeyId: string; secretAccessKey: string }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env)
  return {
    databaseUrl: parsed.DATABASE_URL,
    userAgent: parsed.CRAWLER_USER_AGENT,
    dataDir: parsed.DATA_DIR,
    githubToken: parsed.GITHUB_TOKEN,
    logLevel: parsed.LOG_LEVEL,
    anthropic: { apiKey: parsed.ANTHROPIC_API_KEY, baseURL: parsed.ANTHROPIC_BASE_URL },
    translateModel: parsed.TRANSLATE_MODEL,
    overviewModel: parsed.OVERVIEW_MODEL,
    overviewPremiumModel: parsed.OVERVIEW_PREMIUM_MODEL,
    readmeModel: parsed.README_MODEL,
    readmePremiumModel: parsed.README_PREMIUM_MODEL,
    describeLoopModel: parsed.DESCRIBE_LOOP_MODEL,
    describeModel: parsed.DESCRIBE_MODEL,
    r2:
      parsed.R2_ACCOUNT_ID && parsed.R2_BUCKET && parsed.R2_PUBLIC_BASE_URL && parsed.R2_ACCESS_KEY_ID && parsed.R2_SECRET_ACCESS_KEY
        ? { accountId: parsed.R2_ACCOUNT_ID, bucket: parsed.R2_BUCKET, publicBaseUrl: parsed.R2_PUBLIC_BASE_URL, accessKeyId: parsed.R2_ACCESS_KEY_ID, secretAccessKey: parsed.R2_SECRET_ACCESS_KEY }
        : undefined,
  }
}
