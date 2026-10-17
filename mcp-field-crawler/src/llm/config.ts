import type { AppConfig } from '../config.ts'
import type { LlmConfig, LlmProvider } from './provider.ts'

/* 各模型服务的连接配置（.env 里的密钥和地址）：采集命令和后台接口进程共用 */

export function llmConfigFor(config: AppConfig, provider: LlmProvider): LlmConfig {
  if (provider === 'qwen') {
    if (!config.qwen.apiKey) throw new Error('使用 qwen 模型服务需要 QWEN_API_KEY')
    return { provider, apiKey: config.qwen.apiKey, baseURL: config.qwen.baseURL }
  }
  if (provider === 'opencode') {
    if (!config.opencode.apiKey) throw new Error('使用 opencode 模型服务需要 OPENCODE_API_KEY')
    return { provider, apiKey: config.opencode.apiKey, baseURL: config.opencode.baseURL }
  }
  if (provider === 'minimax') {
    if (!config.minimax.apiKey) throw new Error('使用 minimax 模型服务需要 MINIMAX_API_KEY')
    return { provider, apiKey: config.minimax.apiKey, baseURL: config.minimax.baseURL }
  }
  if (provider === 'openai') {
    if (!config.openai.apiKey) throw new Error('使用 openai 模型服务需要 OPENAI_API_KEY（和 OPENAI_BASE_URL）')
    return { provider: 'openai', apiKey: config.openai.apiKey, baseURL: config.openai.baseURL }
  }
  if (!config.anthropic.apiKey) throw new Error('使用 claude 模型服务需要 ANTHROPIC_API_KEY')
  return { provider: 'claude', apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL }
}

/** 翻译（简介、README、博客）用的模型服务：TRANSLATE_PROVIDER、TRANSLATE_REASONING_EFFORT */
export const translateLlmConfig = (config: AppConfig): LlmConfig => ({ ...llmConfigFor(config, config.translateProvider), reasoningEffort: config.translateReasoningEffort })
