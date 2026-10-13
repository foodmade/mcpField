import { afterEach, describe, expect, it, vi } from 'vitest'
import { capRetryAfter } from '../src/llm/claude.ts'
import { createLlm } from '../src/llm/provider.ts'

/** 拦截 SDK 发出的请求，按接口返回最小的合法响应 */
function stubFetch() {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    requests.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    const body = url.endsWith('/messages')
      ? { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: '<translation>甲</translation>' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
      : { id: 'c1', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '<translation>乙</translation>' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return requests
}

afterEach(() => vi.unstubAllGlobals())

describe('opencode 模型服务', () => {
  it('claude- 开头的模型走 Messages 接口，其余走 OpenAI 兼容接口，都带会话头', async () => {
    const requests = stubFetch()
    const llm = createLlm({ provider: 'opencode', apiKey: 'k', baseURL: 'https://opencode.ai/inference/go/v1', reasoningEffort: 'none' })
    const params = { system: 's', input: 'i', maxTokens: 100, tag: 'translation' }

    expect((await llm.text({ ...params, model: 'claude-haiku-5-5' })).text).toBe('甲')
    expect((await llm.text({ ...params, model: 'mimo-v2.6-flash' })).text).toBe('乙')

    const [claude, openai] = requests
    expect(claude!.url).toBe('https://opencode.ai/inference/go/v1/messages')
    expect(claude!.body).not.toHaveProperty('reasoning_effort')
    expect(openai!.url).toBe('https://opencode.ai/inference/go/v1/chat/completions')
    expect(openai!.body).toMatchObject({ model: 'mimo-v2.6-flash', reasoning_effort: 'none' })
    // 同一次运行共用一个会话
    const session = claude!.headers.get('x-opencode-session')
    expect(session).toBeTruthy()
    expect(openai!.headers.get('x-opencode-session')).toBe(session)
    for (const r of requests) expect(r.headers.get('user-agent')).toBe('mcp-field-crawler/1.0')
  })
})

describe('capRetryAfter', () => {
  const respond = (status: number, headers: Record<string, string>) => vi.stubGlobal('fetch', async () => new Response('{}', { status, headers }))

  it('429 要求等几个小时（额度用完）时去掉 retry-after，SDK 改用默认退避', async () => {
    respond(429, { 'retry-after': '15673' })
    const response = await capRetryAfter('https://x/v1/messages')
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeNull()
  })

  it('短等待和其他状态码原样保留', async () => {
    respond(429, { 'retry-after': '20' })
    expect((await capRetryAfter('https://x')).headers.get('retry-after')).toBe('20')
    respond(503, { 'retry-after': '3600' })
    expect((await capRetryAfter('https://x')).headers.get('retry-after')).toBe('3600')
  })
})
