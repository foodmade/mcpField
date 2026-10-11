import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'

export interface ClaudeConfig {
  apiKey: string
  /** 可指向兼容 Anthropic Messages API 的代理 */
  baseURL?: string
  timeoutMs?: number
}

export interface LlmUsage {
  requests: number
  inputTokens: number
  outputTokens: number
}

/** 输出被 max_tokens 截断：调用方应把批次拆小重试 */
export class TruncatedOutputError extends Error {
  constructor() {
    super('模型输出被截断')
    this.name = 'TruncatedOutputError'
  }
}

/** 模型既没有调用工具，文本里也找不到可解析的 JSON */
export class NoToolOutputError extends Error {
  constructor() {
    super('模型没有返回结构化结果')
    this.name = 'NoToolOutputError'
  }
}

export function createClaude(config: ClaudeConfig): Anthropic {
  return new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 4, timeout: config.timeoutMs ?? 300_000 })
}

/** 不支持强制指定工具的模型（例如默认开启推理的模型），首次被拒后记住，之后直接用 auto */
const autoToolModels = new Set<string>()
/** auto 模式下模型可能先推理再调用工具，多留一些输出额度 */
const AUTO_EXTRA_TOKENS = 8_000
const MAX_OUTPUT_TOKENS = 32_000

/** 快速模型有时把工具参数里的数组/对象写成 JSON 字符串：顶层字段是 JSON 字符串时还原 */
export function unwrapJsonStrings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
      if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return [k, v]
      try {
        return [k, JSON.parse(v) as unknown]
      } catch {
        return [k, v]
      }
    }),
  )
}

/** 从文本回复里找出 JSON（兼容 ```json 代码块） */
function jsonFromText(blocks: Anthropic.ContentBlock[]): unknown {
  const text = blocks
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

/**
 * 让模型通过指定工具返回结构化输出，并用 zod 校验。
 * 优先强制调用工具；模型不支持时自动改用 auto，并兼容模型直接在文本里返回 JSON 的情况。
 * 系统提示词开启缓存：同一批任务里重复的系统提示词只完整计费一次（取决于服务方是否支持）。
 */
export async function callTool<T>(
  client: Anthropic,
  params: { model: string; system: string; tool: Anthropic.Tool; input: string; maxTokens: number; schema: z.ZodType<T>; signal?: AbortSignal },
): Promise<{ output: T; usage: LlmUsage }> {
  const request = async (forced: boolean) => {
    const response = await client.messages.create(
      {
        model: params.model,
        max_tokens: Math.min(MAX_OUTPUT_TOKENS, params.maxTokens + (forced ? 0 : AUTO_EXTRA_TOKENS)),
        system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
        tools: [params.tool],
        tool_choice: forced ? { type: 'tool', name: params.tool.name } : { type: 'auto' },
        messages: [{ role: 'user', content: params.input }],
      },
      { signal: params.signal },
    )
    if (response.stop_reason === 'max_tokens') throw new TruncatedOutputError()

    const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === params.tool.name)
    const raw = block ? block.input : jsonFromText(response.content)
    if (raw === undefined) throw new NoToolOutputError()
    const u = response.usage
    return {
      output: params.schema.parse(unwrapJsonStrings(raw)),
      usage: {
        requests: 1,
        inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens,
      },
    }
  }

  const forced = !autoToolModels.has(params.model)
  try {
    return await request(forced)
  } catch (error) {
    if (forced && error instanceof Anthropic.BadRequestError && /tool_choice/i.test(error.message)) {
      autoToolModels.add(params.model)
      return request(false)
    }
    throw error
  }
}

/**
 * 纯文本输出：适合整段 Markdown 这类长文本（放进 JSON 需要大量转义）。
 * 要求模型把结果放在 <tag>…</tag> 里，只取标签内的内容；没有闭合标签说明被截断。
 */
export async function callText(
  client: Anthropic,
  params: { model: string; system: string; input: string; maxTokens: number; tag: string; signal?: AbortSignal },
): Promise<{ text: string; usage: LlmUsage }> {
  const response = await client.messages.create(
    {
      model: params.model,
      max_tokens: Math.min(MAX_OUTPUT_TOKENS, params.maxTokens),
      system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: params.input }],
    },
    { signal: params.signal },
  )
  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const open = raw.indexOf(`<${params.tag}>`)
  const close = raw.lastIndexOf(`</${params.tag}>`)
  if (response.stop_reason === 'max_tokens' || (open >= 0 && close < open)) throw new TruncatedOutputError()
  if (open < 0 || close < 0) throw new NoToolOutputError()
  const u = response.usage
  return {
    text: raw.slice(open + params.tag.length + 2, close).replace(/^\n+|\n+$/g, ''),
    usage: {
      requests: 1,
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    },
  }
}
