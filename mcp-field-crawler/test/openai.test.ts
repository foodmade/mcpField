import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { NoToolOutputError, TruncatedOutputError } from '../src/llm/claude.ts'
import { callTextOpenAI, callToolOpenAI } from '../src/llm/openai.ts'

/** 只实现用到的 chat.completions.create，记录请求参数 */
function fakeClient(response: unknown) {
  const requests: Record<string, unknown>[] = []
  const client = { chat: { completions: { create: async (body: Record<string, unknown>) => (requests.push(body), response) } } } as unknown as OpenAI
  return { client, requests }
}

const tool = { name: 'submit', description: 'Submit', input_schema: { type: 'object' as const, properties: { zh: { type: 'string' } }, required: ['zh'] } }
const schema = z.object({ zh: z.string() })
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

describe('callToolOpenAI', () => {
  it('把工具转成函数并强制调用，解析参数并校验', async () => {
    const { client, requests } = fakeClient({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit', arguments: '{"zh":"快速搜索"}' } }] } }], usage })
    const result = await callToolOpenAI(client, { model: 'gpt-6-luna', system: 'sys', tool, input: 'in', maxTokens: 100, schema })
    expect(result).toEqual({ output: { zh: '快速搜索' }, usage: { requests: 1, inputTokens: 10, outputTokens: 5 } })
    expect(requests[0]).toMatchObject({
      model: 'gpt-6-luna',
      // 正文额度之外留出推理余量
      max_completion_tokens: 4_100,
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'in' }],
      tools: [{ type: 'function', function: { name: 'submit', parameters: tool.input_schema } }],
      tool_choice: { type: 'function', function: { name: 'submit' } },
    })
  })

  it('配置了推理强度时带上 reasoning_effort，否则不带', async () => {
    const response = { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit', arguments: '{"zh":"x"}' } }] } }], usage }
    const params = { model: 'deepseek-v4.1-flash', system: 's', tool, input: 'i', maxTokens: 10, schema }
    const withEffort = fakeClient(response)
    await callToolOpenAI(withEffort.client, params, { reasoningEffort: 'none' })
    expect(withEffort.requests[0]).toMatchObject({ reasoning_effort: 'none' })
    const plain = fakeClient(response)
    await callToolOpenAI(plain.client, params)
    expect(plain.requests[0]).not.toHaveProperty('reasoning_effort')
  })

  it('输出被截断、没有调用工具、参数不是 JSON 时报对应的错误（批处理据此拆批重试）', async () => {
    const params = { model: 'm', system: 's', tool, input: 'i', maxTokens: 10, schema }
    await expect(callToolOpenAI(fakeClient({ choices: [{ finish_reason: 'length', message: {} }] }).client, params)).rejects.toBeInstanceOf(TruncatedOutputError)
    await expect(callToolOpenAI(fakeClient({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }).client, params)).rejects.toBeInstanceOf(NoToolOutputError)
    await expect(callToolOpenAI(fakeClient({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'submit', arguments: '{oops' } }] } }] }).client, params)).rejects.toBeInstanceOf(NoToolOutputError)
  })
})

describe('callTextOpenAI', () => {
  const params = { model: 'm', system: 's', input: 'i', maxTokens: 10, tag: 'translation' }

  it('取出标签里的内容', async () => {
    const { client } = fakeClient({ choices: [{ finish_reason: 'stop', message: { content: 'ok <translation>\n## 功能\n</translation>' } }], usage })
    expect((await callTextOpenAI(client, params)).text).toBe('## 功能')
  })

  it('先去掉正文里的 <think> 推理块（MiniMax M2 系列），里面提到的标签不干扰结果', async () => {
    const content = '<think>I will wrap it in <translation> tags…</think>\n<translation>\n## 功能\n</translation>'
    const { client } = fakeClient({ choices: [{ finish_reason: 'stop', message: { content } }], usage })
    expect((await callTextOpenAI(client, params)).text).toBe('## 功能')
  })

  it('没有闭合标签或被截断时报截断，没有标签时报没有结果', async () => {
    await expect(callTextOpenAI(fakeClient({ choices: [{ finish_reason: 'stop', message: { content: '<translation>half' } }] }).client, params)).rejects.toBeInstanceOf(TruncatedOutputError)
    await expect(callTextOpenAI(fakeClient({ choices: [{ finish_reason: 'length', message: { content: '<translation>x</translation>' } }] }).client, params)).rejects.toBeInstanceOf(TruncatedOutputError)
    await expect(callTextOpenAI(fakeClient({ choices: [{ finish_reason: 'stop', message: { content: 'no tag' } }] }).client, params)).rejects.toBeInstanceOf(NoToolOutputError)
  })
})
