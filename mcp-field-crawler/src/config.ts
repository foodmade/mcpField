import { LLM_PROVIDERS, REASONING_EFFORTS, type LlmProvider, type ReasoningEffort } from './llm/providers.ts'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  TRANSLATE_MODEL: z.string().trim().default('claude-haiku-5-5'),
  OVERVIEW_MODEL: z.string().trim().default('claude-haiku-5-5'),
  /** 热门项目单独用的模型；不设置时不分档，所有条目都用 OVERVIEW_MODEL */
  OVERVIEW_PREMIUM_MODEL: optionalString,
  README_MODEL: z.string().trim().default('claude-haiku-5-5'),
  /** 同上：不设置时所有 README 都用 README_MODEL */
  README_PREMIUM_MODEL: optionalString,
  /** Loop 内容要写步骤，用更强的模型；CLI / Agent 用快速模型 */
  DESCRIBE_LOOP_MODEL: z.string().trim().default('claude-sonnet-5-5'),
  DESCRIBE_MODEL: z.string().trim().default('claude-haiku-5-5'),
  CLASSIFY_MODEL: z.string().trim().default('claude-opus-5-5'),
  /** 翻译（简介、README）用哪个模型服务：claude、openai（OpenAI 兼容接口，如 ChatGPT 模型）、minimax、opencode 或 qwen */
  TRANSLATE_PROVIDER: z.enum(LLM_PROVIDERS).default('claude'),
  /** 翻译时推理模型的推理强度（OpenAI 兼容接口的 reasoning_effort）；不设置时用模型默认值。MiniMax M3 不允许 none */
  TRANSLATE_REASONING_EFFORT: z.enum(REASONING_EFFORTS).optional(),
  /** AI 介绍用哪个模型服务，取值同上 */
  OVERVIEW_PROVIDER: z.enum(LLM_PROVIDERS).default('claude'),
  /** 分类器用哪个模型服务，取值同上 */
  CLASSIFY_PROVIDER: z.enum(LLM_PROVIDERS).default('claude'),
  /** 自撰内容（Loop / CLI / Agent）用哪个模型服务，取值同上 */
  DESCRIBE_PROVIDER: z.enum(LLM_PROVIDERS).default('claude'),
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,
  MINIMAX_API_KEY: optionalString,
  /** MiniMax 的 OpenAI 兼容接口；国内站 api.minimaxi.com，国际站 api.minimax.io（密钥不通用） */
  MINIMAX_BASE_URL: z.string().trim().default('https://api.minimaxi.com/v1'),
  OPENCODE_API_KEY: optionalString,
  /** OpenCode Go 订阅的 OpenAI 兼容接口；DeepSeek 等模型要求工作区 Privacy 设置选 Global 区域 */
  OPENCODE_BASE_URL: z.string().trim().default('https://opencode.ai/inference/go/v1'),
  QWEN_API_KEY: optionalString,
  /** 阿里云百炼的 OpenAI 兼容接口；业务空间有专属地址时换成它（…/compatible-mode/v1） */
  QWEN_BASE_URL: z.string().trim().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  /** 翻译（简介、README）的默认并发数；不设置时简介 4、README 6（适合 Claude 网关）。代理并发上限高时调大，命令行的 --concurrency 优先 */
  TRANSLATE_CONCURRENCY: z.coerce.number().int().positive().optional(),
  /** skills.sh API 令牌所在目录：一个已 vercel link 的空项目，令牌在它的 .env.local 里（见 docs/DESIGN.md） */
  SKILLS_SH_VERCEL_DIR: z.string().trim().default(join(homedir(), '.mcpfield', 'skills-sh')),
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
  overviewPremiumModel: string | undefined
  readmeModel: string
  readmePremiumModel: string | undefined
  describeLoopModel: string
  describeModel: string
  classifyModel: string
  translateProvider: LlmProvider
  translateReasoningEffort?: ReasoningEffort
  overviewProvider: LlmProvider
  classifyProvider: LlmProvider
  describeProvider: LlmProvider
  openai: { apiKey?: string; baseURL?: string }
  minimax: { apiKey?: string; baseURL: string }
  opencode: { apiKey?: string; baseURL: string }
  qwen: { apiKey?: string; baseURL: string }
  translateConcurrency?: number
  skillsShVercelDir: string
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
    classifyModel: parsed.CLASSIFY_MODEL,
    translateProvider: parsed.TRANSLATE_PROVIDER,
    translateReasoningEffort: parsed.TRANSLATE_REASONING_EFFORT,
    overviewProvider: parsed.OVERVIEW_PROVIDER,
    classifyProvider: parsed.CLASSIFY_PROVIDER,
    describeProvider: parsed.DESCRIBE_PROVIDER,
    openai: { apiKey: parsed.OPENAI_API_KEY, baseURL: parsed.OPENAI_BASE_URL },
    minimax: { apiKey: parsed.MINIMAX_API_KEY, baseURL: parsed.MINIMAX_BASE_URL },
    opencode: { apiKey: parsed.OPENCODE_API_KEY, baseURL: parsed.OPENCODE_BASE_URL },
    qwen: { apiKey: parsed.QWEN_API_KEY, baseURL: parsed.QWEN_BASE_URL },
    translateConcurrency: parsed.TRANSLATE_CONCURRENCY,
    skillsShVercelDir: parsed.SKILLS_SH_VERCEL_DIR,
    r2:
      parsed.R2_ACCOUNT_ID && parsed.R2_BUCKET && parsed.R2_PUBLIC_BASE_URL && parsed.R2_ACCESS_KEY_ID && parsed.R2_SECRET_ACCESS_KEY
        ? { accountId: parsed.R2_ACCOUNT_ID, bucket: parsed.R2_BUCKET, publicBaseUrl: parsed.R2_PUBLIC_BASE_URL, accessKeyId: parsed.R2_ACCESS_KEY_ID, secretAccessKey: parsed.R2_SECRET_ACCESS_KEY }
        : undefined,
  }
}
