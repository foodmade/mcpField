import { randomUUID } from 'node:crypto'
import { callText, callTool, createClaude, type LlmUsage, type TextCallParams, type ToolCallParams } from './claude.ts'
import { callTextOpenAI, callToolOpenAI, createOpenAI } from './openai.ts'

import type { LlmProvider, ReasoningEffort } from './providers.ts'

export type { LlmProvider } from './providers.ts'

export interface LlmConfig {
  provider: LlmProvider
  apiKey: string
  baseURL?: string
  /** 推理强度（只对 OpenAI 兼容接口生效）；翻译不需要推理，DeepSeek 设为 none 后长片段从约 99 秒降到 8 秒 */
  reasoningEffort?: ReasoningEffort
  /** 单次请求超时（毫秒），默认 5 分钟 */
  timeoutMs?: number
  /** SDK 自动重试次数，默认 4 */
  maxRetries?: number
}

/** 与模型服务无关的两种调用方式；翻译器只依赖它 */
export interface Llm {
  readonly provider: LlmProvider
  tool<T>(params: ToolCallParams<T>): Promise<{ output: T; usage: LlmUsage }>
  text(params: TextCallParams): Promise<{ text: string; usage: LlmUsage }>
}

/**
 * OpenCode Go 要求客户端用自己的 User-Agent 标明身份，并带稳定的 x-opencode-session 以便路由和提示词缓存，
 * 缺少会话头直接返回 400。一次运行用同一个会话（各请求的系统提示词相同，能命中缓存）。
 */
const opencodeHeaders = () => ({ 'user-agent': 'mcp-field-crawler/1.0', 'x-opencode-session': randomUUID() })

export function createLlm(config: LlmConfig): Llm {
  if (config.provider === 'opencode') return createOpencodeLlm(config)
  if (config.provider === 'openai' || config.provider === 'minimax' || config.provider === 'qwen') {
    const client = createOpenAI(config)
    const options = { reasoningEffort: config.reasoningEffort }
    return { provider: config.provider, tool: (p) => callToolOpenAI(client, p, options), text: (p) => callTextOpenAI(client, p, options) }
  }
  const client = createClaude(config)
  return { provider: 'claude', tool: (p) => callTool(client, p), text: (p) => callText(client, p) }
}

/**
 * OpenCode Go 上 Claude 模型走 Anthropic Messages 接口（/v1/messages），其余模型走 OpenAI 兼容接口。
 * 按每次调用的模型名分流，README 的热门档（如 claude-haiku-5-5）和普通档（如 mimo-v2.6-flash）就能共用这一个模型服务。
 */
function createOpencodeLlm(config: LlmConfig): Llm {
  const headers = opencodeHeaders()
  const openai = createOpenAI({ ...config, headers })
  // OPENCODE_BASE_URL 是 OpenAI 兼容地址（…/go/v1），Anthropic SDK 会自己拼上 /v1/messages
  const claude = createClaude({ apiKey: config.apiKey, baseURL: config.baseURL?.replace(/\/v1\/?$/, ''), headers, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries })
  const options = { reasoningEffort: config.reasoningEffort }
  const isClaude = (model: string) => model.startsWith('claude-')
  return {
    provider: 'opencode',
    tool: (p) => (isClaude(p.model) ? callTool(claude, p) : callToolOpenAI(openai, p, options)),
    text: (p) => (isClaude(p.model) ? callText(claude, p) : callTextOpenAI(openai, p, options)),
  }
}
