import Anthropic from '@anthropic-ai/sdk'
import type { z } from 'zod'

export interface ClaudeConfig {
  apiKey: string
  /** 可指向兼容 Anthropic Messages API 的代理 */
  baseURL?: string
  timeoutMs?: number
  /** SDK 自动重试次数（超时、429、5xx），默认 4 */
  maxRetries?: number
  /** 每个请求都带上的额外请求头 */
  headers?: Record<string, string>
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

/** 服务端要求等待超过这个时长时不照办（与 OpenAI SDK 的上限一致） */
const MAX_RETRY_AFTER_SECONDS = 60

/**
 * Anthropic SDK 会照 retry-after 等待（最长约 24 天）。订阅额度用完时（例如 OpenCode Go 的 5 小时窗口）服务端会让等几个小时，
 * 请求就一直挂着、既不成功也不报错。等待超过一分钟时去掉这个头，SDK 改用默认退避，重试用完后报 429，由调用方决定降级还是失败
 */
export const capRetryAfter: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  const headers = response.headers
  const waitSeconds = Number(headers.get('retry-after-ms')) / 1000 || Number(headers.get('retry-after'))
  if (response.status !== 429 || !(waitSeconds > MAX_RETRY_AFTER_SECONDS)) return response
  const capped = new Headers(headers)
  capped.delete('retry-after')
  capped.delete('retry-after-ms')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: capped })
}

export function createClaude(config: ClaudeConfig): Anthropic {
  return new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: config.maxRetries ?? 4, timeout: config.timeoutMs ?? 300_000, defaultHeaders: config.headers, fetch: capRetryAfter })
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
/** 结构化输出调用的参数（各模型服务共用；工具定义沿用 Anthropic 的格式，OpenAI 兼容接口会转换） */
export interface ToolCallParams<T> {
  model: string
  system: string
  tool: Anthropic.Tool
  input: string
  maxTokens: number
  schema: z.ZodType<T>
  signal?: AbortSignal
}

/** 纯文本输出调用的参数：结果放在 <tag>…</tag> 里 */
export interface TextCallParams {
  model: string
  system: string
  input: string
  maxTokens: number
  tag: string
  signal?: AbortSignal
}

/** 从 <tag>…</tag> 里取出结果；没有闭合标签说明被截断 */
export function textInTag(raw: string, tag: string, truncated: boolean): string {
  const open = raw.indexOf(`<${tag}>`)
  const close = raw.lastIndexOf(`</${tag}>`)
  if (truncated || (open >= 0 && close < open)) throw new TruncatedOutputError()
  if (open < 0 || close < 0) throw new NoToolOutputError()
  return raw.slice(open + tag.length + 2, close).replace(/^\n+|\n+$/g, '')
}

export async function callTool<T>(client: Anthropic, params: ToolCallParams<T>): Promise<{ output: T; usage: LlmUsage }> {
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
export async function callText(client: Anthropic, params: TextCallParams): Promise<{ text: string; usage: LlmUsage }> {
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
  const text = textInTag(raw, params.tag, response.stop_reason === 'max_tokens')
  const u = response.usage
  return {
    text,
    usage: {
      requests: 1,
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
    },
  }
}
