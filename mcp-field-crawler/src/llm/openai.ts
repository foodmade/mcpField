import OpenAI from 'openai'
import { NoToolOutputError, textInTag, TruncatedOutputError, unwrapJsonStrings, type LlmUsage, type TextCallParams, type ToolCallParams } from './claude.ts'
import type { ReasoningEffort } from './providers.ts'

/*
 * OpenAI 兼容接口（ChatGPT 模型，或兼容 /v1/chat/completions 的代理）的调用：与 llm/claude.ts 的 callTool / callText 行为一致，
 * 翻译器可以按配置在两者之间切换（见 llm/provider.ts）。
 */

export interface OpenAIConfig {
  apiKey: string
  /** OpenAI 兼容接口地址，例如 https://host/v1 */
  baseURL?: string
  timeoutMs?: number
  /** 每个请求都带上的额外请求头 */
  headers?: Record<string, string>
}

export function createOpenAI(config: OpenAIConfig): OpenAI {
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 4, timeout: config.timeoutMs ?? 300_000, defaultHeaders: config.headers })
}

/**
 * 推理模型（MiniMax M3、GPT 系列）的思考过程也计入 max_completion_tokens：在调用方估算的正文额度之外留出余量，
 * 否则一批条目稍多就会被截断、拆批重做（2026-10 MiniMax 简介翻译实测每批 40 条时频繁截断）。
 */
const REASONING_EXTRA_TOKENS = 4_000
const MAX_OUTPUT_TOKENS = 32_000
const outputBudget = (maxTokens: number) => Math.min(MAX_OUTPUT_TOKENS, maxTokens + REASONING_EXTRA_TOKENS)

/** 跟随客户端、对每个请求生效的选项 */
export interface OpenAIRequestOptions {
  /** 不设置时用模型默认的推理强度 */
  reasoningEffort?: ReasoningEffort
}

function usageOf(u: OpenAI.CompletionUsage | undefined): LlmUsage {
  return { requests: 1, inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 }
}

/** 强制调用函数工具拿到结构化输出，再用 zod 校验 */
export async function callToolOpenAI<T>(client: OpenAI, params: ToolCallParams<T>, options: OpenAIRequestOptions = {}): Promise<{ output: T; usage: LlmUsage }> {
  const response = await client.chat.completions.create(
    {
      model: params.model,
      max_completion_tokens: outputBudget(params.maxTokens),
      ...(options.reasoningEffort && { reasoning_effort: options.reasoningEffort }),
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.input },
      ],
      tools: [{ type: 'function', function: { name: params.tool.name, description: params.tool.description, parameters: params.tool.input_schema as Record<string, unknown> } }],
      tool_choice: { type: 'function', function: { name: params.tool.name } },
    },
    { signal: params.signal },
  )
  const choice = response.choices[0]
  if (choice?.finish_reason === 'length') throw new TruncatedOutputError()
  const call = choice?.message.tool_calls?.find((c) => c.type === 'function' && c.function.name === params.tool.name)
  if (!call || call.type !== 'function') throw new NoToolOutputError()
  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments)
  } catch {
    throw new NoToolOutputError()
  }
  return { output: params.schema.parse(unwrapJsonStrings(raw)), usage: usageOf(response.usage) }
}

/** 纯文本输出：结果在 <tag>…</tag> 里 */
export async function callTextOpenAI(client: OpenAI, params: TextCallParams, options: OpenAIRequestOptions = {}): Promise<{ text: string; usage: LlmUsage }> {
  const response = await client.chat.completions.create(
    {
      model: params.model,
      max_completion_tokens: outputBudget(params.maxTokens),
      ...(options.reasoningEffort && { reasoning_effort: options.reasoningEffort }),
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.input },
      ],
    },
    { signal: params.signal },
  )
  const choice = response.choices[0]
  // 部分模型（MiniMax M2 系列）把推理过程放在正文的 <think> 块里，先去掉，避免里面提到的标签干扰
  const content = (choice?.message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
  return { text: textInTag(content, params.tag, choice?.finish_reason === 'length'), usage: usageOf(response.usage) }
}
