import { describe, expect, it, vi } from 'vitest'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import type { EntityDraft, ServerDetailDraft } from '../src/core/draft.ts'
import type { Logger } from '../src/core/logger.ts'
import { toToolDrafts } from '../src/extract/mcp-tools.ts'
import { QUEUE, type QueueClient } from '../src/probe/queue.ts'
import { pickRemote, probeRemote, type RemoteProbeTarget } from '../src/probe/remote.ts'
import type { DockerSandbox } from '../src/probe/sandbox.ts'
import { applyProbedTools, probeKeys, type ToolsProbeResult } from '../src/probe/tools-store.ts'
import { runProbeWorker } from '../src/probe/worker.ts'

const listRemoteTools = vi.hoisted(() => vi.fn())
vi.mock('../src/probe/mcp-remote.ts', () => ({ listRemoteTools }))

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

const detail = (over: Partial<ServerDetailDraft> = {}): ServerDetailDraft => ({ isRemote: true, transports: ['streamable-http'], packages: [], envVars: [], remotes: [], tools: [], ...over })
const server = (over: Partial<ServerDetailDraft>): EntityDraft =>
  new DraftBuilder({ kind: 'server', sourceId: 'mcp-registry', externalId: 'io.github.acme/puck', sourceUrl: 'https://registry.example/puck', slug: 'puck', name: 'Puck' }, detail(over)).build() as EntityDraft

const raw = [{ name: 'get_standings', description: 'Use when checking where teams rank.', inputSchema: { type: 'object', properties: { season: { type: 'string' } } } }]

describe('远程服务的实测结果补给发布条目', () => {
  it('远程地址也算实测键（排在安装包后面），带占位符的地址跳过', () => {
    const draft = server({
      packages: [{ registryType: 'npm', identifier: 'puck-mcp' }],
      remotes: [
        { transport: 'streamable-http', url: 'https://api.puck.dev/mcp' },
        { transport: 'streamable-http', url: 'https://{tenant}.puck.dev/mcp' },
      ],
    })
    expect(probeKeys(draft)).toEqual(['npm:puck-mcp', 'remote:api.puck.dev/mcp'])
  })

  it('远程地址取自条目自己的数据，不核对仓库也补；工具参数照样展开', () => {
    const draft = server({ remotes: [{ transport: 'streamable-http', url: 'https://api.puck.dev/mcp' }] })
    // probeRemote 存的是 listRemoteTools 转好的工具，publish 时再转一次结果不变
    const probes = new Map([['remote:api.puck.dev/mcp', { tools: toToolDrafts(raw), probedAt: '2026-10-17T00:00:00.000Z' }]])
    expect(applyProbedTools(draft, probes)).toBe(true)
    expect(draft.kind === 'server' && draft.detail.tools[0]).toMatchObject({ name: 'get_standings', params: [{ path: 'season', jsonType: 'string' }] })
  })

  it('优先用 Streamable HTTP 地址', () => {
    expect(pickRemote([{ transport: 'sse', url: 'https://a/sse' }, { transport: 'streamable-http', url: 'https://a/mcp' }])?.url).toBe('https://a/mcp')
    expect(pickRemote([{ transport: 'sse', url: 'https://a/sse' }])?.url).toBe('https://a/sse')
  })

  it('读到工具记为 ok，要鉴权等错误如实记下状态', async () => {
    const target: RemoteProbeTarget = { key: 'remote:api.puck.dev/mcp', registryType: 'remote', url: 'https://api.puck.dev/mcp', transport: 'streamable-http', stars: 3 }
    listRemoteTools.mockResolvedValueOnce({ tools: toToolDrafts(raw) })
    expect(await probeRemote(target)).toMatchObject({ key: target.key, status: 'ok', tools: [{ name: 'get_standings' }] })
    listRemoteTools.mockResolvedValueOnce({ error: 'auth', status: 401 })
    expect(await probeRemote(target)).toMatchObject({ key: target.key, status: 'auth', error: 'HTTP 401' })
  })
})

/** 内存里的队列：只实现 worker 用到的命令 */
class FakeQueue {
  readonly lists = new Map<string, string[]>()
  duplicate() {
    return this
  }
  on() {
    return this
  }
  async connect() {}
  async close() {}
  async blPop(keys: string[]) {
    for (const key of keys) {
      const list = this.lists.get(key)
      if (list?.length) return { key, element: list.shift()! }
    }
    await new Promise((r) => setTimeout(r, 5))
    return null
  }
  async rPush(key: string, value: string) {
    this.lists.set(key, [...(this.lists.get(key) ?? []), value])
    return this.lists.get(key)!.length
  }
}

describe('实测 worker', () => {
  it('先取 high 再取 low，结果写回队列；收到中断信号后退出', async () => {
    const queue = new FakeQueue()
    const job = (name: string): RemoteProbeTarget => ({ key: `remote:${name}`, registryType: 'remote', url: `https://${name}/mcp`, transport: 'streamable-http', stars: null })
    await queue.rPush(QUEUE.jobs('remote', 'low'), JSON.stringify(job('backlog.dev')))
    await queue.rPush(QUEUE.jobs('remote', 'high'), JSON.stringify(job('new.dev')))
    listRemoteTools.mockResolvedValue({ tools: toToolDrafts(raw) })

    const controller = new AbortController()
    const running = runProbeWorker(queue as unknown as QueueClient, {} as DockerSandbox, silent, { local: 0, remote: 1, signal: controller.signal })
    await vi.waitFor(() => expect(queue.lists.get(QUEUE.results)).toHaveLength(2))
    controller.abort()
    const stats = await running

    const results = queue.lists.get(QUEUE.results)!.map((line) => JSON.parse(line) as ToolsProbeResult)
    expect(results.map((r) => r.key)).toEqual(['remote:new.dev', 'remote:backlog.dev'])
    expect(results.every((r) => r.status === 'ok' && r.tools?.length === 1)).toBe(true)
    expect(stats).toMatchObject({ finished: 2, ok: 2 })
  })
})
