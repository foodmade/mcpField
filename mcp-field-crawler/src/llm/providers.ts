/**
 * 模型服务：claude = Anthropic Messages API；openai = OpenAI 兼容的 /v1/chat/completions（ChatGPT 模型）；
 * minimax = MiniMax；opencode = OpenCode Go 订阅；qwen = 阿里云百炼（后三者同样是 OpenAI 兼容接口）
 */
export const LLM_PROVIDERS = ['claude', 'openai', 'minimax', 'opencode', 'qwen'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

/** OpenAI 兼容接口的 reasoning_effort；Claude 忽略 */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
