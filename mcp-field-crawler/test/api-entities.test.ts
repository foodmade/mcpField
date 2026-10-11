import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { ListQuery, Scope } from '../src/api/http/query.ts'
import { EntityService } from '../src/api/modules/entities/entity.service.ts'
import { PRESENTERS } from '../src/api/modules/entities/presenters.ts'
import type { EntityReadRepository, EntityRow, TypeCount } from '../src/api/repositories/types.ts'
import type { EntityDraftOf } from '../src/core/draft.ts'
import type { Logger } from '../src/core/logger.ts'
import type { EntityKind, SourceRecord } from '../src/core/types.ts'
import { McpSoMapper } from '../src/sources/mcpso/mapper.ts'
import type { McpSoData } from '../src/sources/mcpso/schema.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

function draft<K extends EntityKind>(kind: K, item: Record<string, unknown>, context: McpSoData['context'] = {}): EntityDraftOf<K> {
  const record: SourceRecord<McpSoData> = { sourceId: 'mcpso', kind, externalId: String(item.slug), url: `https://mcp.so/x/${String(item.slug)}`, parserVersion: 1, fetchedAt: new Date(), data: { item: item as McpSoData['item'], context } }
  return new McpSoMapper(kind).map(record) as EntityDraftOf<K>
}

class FakeRepository<K extends EntityKind> implements EntityReadRepository<K> {
  lastQuery?: ListQuery
  lastScope?: Scope
  constructor(private readonly drafts: EntityDraftOf<K>[]) {}
  private row(d: EntityDraftOf<K>): EntityRow<K> {
    return { draft: d, fetchedAt: '2026-10-10T00:00:00.000Z', mappedAt: '2026-10-10T00:00:00.000Z' }
  }
  async list(query: ListQuery) {
    this.lastQuery = query
    const rows = this.drafts.filter((d) => query.remote === undefined || (d.detail as { isRemote?: boolean }).isRemote === query.remote)
    return { rows: rows.map((d) => this.row(d)), total: rows.length }
  }
  async findBySlug(slug: string) {
    const d = this.drafts.find((x) => x.slug === slug)
    return d ? this.row(d) : null
  }
  async categoryCounts(scope?: Scope) {
    this.lastScope = scope
    return []
  }
  async typeCounts(): Promise<TypeCount[]> {
    return []
  }
  async sitemap(offset: number, limit: number) {
    return { rows: this.drafts.slice(offset, offset + limit).map((d) => ({ slug: d.slug, updatedAt: d.sourceUpdatedAt ?? null })), total: this.drafts.length }
  }
  async viewCounts() {
    return { official: 0, featured: 0, verified: 0 }
  }
}

const servers = new FakeRepository<'server'>([
  draft('server', {
    slug: 'demo-remote',
    name: 'Demo Remote',
    tagline: 'Remote demo server',
    repoUrl: 'https://github.com/acme/demo-remote',
    isRemote: true,
    transports: '["streamable-http"]',
    config: '{"mcpServers":{"demo":{"command":"npx","args":["-y","@acme/demo"],"env":{"ACME_TOKEN":"secret-value"}}}}',
    tools: '[{"name":"search","description":"Search things","inputSchema":{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}}]',
  }),
  draft('server', { slug: 'demo-local', name: 'Demo Local', tagline: 'Local demo', repoUrl: 'https://github.com/acme/demo-local', isRemote: false }),
])
const skills = new FakeRepository<'skill'>([
  draft('skill', { slug: 'pdf', name: 'pdf', canonicalKey: 'anthropics/skills#pdf', owner: 'anthropics', repository: 'skills', description: 'Work with PDF files', installs: 1234, official: true, installCommand: 'npx skills add pdf' }),
])

const app = createApp({
  entities: {
    server: new EntityService('server', servers, PRESENTERS.server),
    skill: new EntityService('skill', skills, PRESENTERS.skill),
  },
  logger: silent,
})

describe('通用目录接口', () => {
  it('按类型挂载路由；没提供的类型返回 404', async () => {
    expect((await app.request('/api/servers')).status).toBe(200)
    expect((await app.request('/api/skills')).status).toBe(200)
    expect((await app.request('/api/clients')).status).toBe(404)
  })

  it('MCP 服务：remote 过滤；列表带远程标记和工具数；详情带安装包、环境变量名、工具参数，不含变量取值', async () => {
    const list = (await (await app.request('/api/servers?remote=true')).json()) as { data: Record<string, unknown>[] }
    expect(list.data.map((s) => s.slug)).toEqual(['demo-remote'])
    expect(list.data[0]).toMatchObject({ kind: 'server', isRemote: true, toolsCount: 1, transports: ['streamable-http'] })

    const res = await app.request('/api/servers/demo-remote')
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data).toMatchObject({
      packages: [{ registryType: 'npm', identifier: '@acme/demo' }],
      envVars: [{ name: 'ACME_TOKEN', required: true, secret: true }],
      tools: [{ name: 'search', params: [{ path: 'q', type: 'string', required: true }] }],
    })
    expect(JSON.stringify(body)).not.toContain('secret-value')
  })

  it('facets 的 remote 范围传到仓储', async () => {
    await app.request('/api/servers/facets?remote=true')
    expect(servers.lastScope).toEqual({ remote: true })
  })

  it('Skill：description 作为简介，返回安装量和官方标记；默认按热度排序', async () => {
    const list = (await (await app.request('/api/skills')).json()) as { data: Record<string, unknown>[] }
    expect(list.data[0]).toMatchObject({ kind: 'skill', tagline: 'Work with PDF files', installs: 1234, official: true, installCommand: 'npx skills add pdf' })
    expect(skills.lastQuery?.sort).toBe('popular')
    expect(PRESENTERS.skill.popularMetric).toBe('skill_installs')
  })

  it('Agent：列表返回子类型，type 参数传到仓储，facets 带各子类型数量', async () => {
    class AgentRepository extends FakeRepository<'agent'> {
      override async typeCounts() {
        return [{ value: 'product', count: 1 }]
      }
    }
    const agents = new AgentRepository([draft('agent', { slug: 'claude-code', name: 'Claude Code', type: 'product', categories: '["coding-agent"]' })])
    const agentApp = createApp({ entities: { agent: new EntityService('agent', agents, PRESENTERS.agent) }, logger: silent })
    const list = (await (await agentApp.request('/api/agents?type=product')).json()) as { data: Record<string, unknown>[] }
    expect(list.data[0]).toMatchObject({ kind: 'agent', agentType: 'product' })
    expect(agents.lastQuery?.type).toBe('product')
    const facets = (await (await agentApp.request('/api/agents/facets')).json()) as { data: { types: unknown } }
    expect(facets.data.types).toEqual([{ value: 'product', count: 1 }])
    expect((await agentApp.request('/api/agents?type=Product!')).status).toBe(400)
  })

  it('sitemap：汇总各类型总数，按类型分页列出 slug', async () => {
    const summary = (await (await app.request('/api/sitemap')).json()) as { data: unknown[] }
    expect(summary.data).toEqual([
      { kind: 'server', route: 'servers', total: 2 },
      { kind: 'skill', route: 'skills', total: 1 },
    ])
    const page = (await (await app.request('/api/sitemap/server?pageSize=1&page=2')).json()) as { data: { slug: string }[]; meta: { total: number } }
    expect(page.data.map((r) => r.slug)).toEqual(['demo-local'])
    expect(page.meta.total).toBe(2)
    expect((await app.request('/api/sitemap/nope')).status).toBe(404)
  })

  it('404 提示带类型名', async () => {
    const body = (await (await app.request('/api/skills/nope')).json()) as { error: { message: string } }
    expect(body.error.message).toBe('Skill "nope" 不存在')
  })
})

describe('远程工具实时读取', () => {
  it('地址取自收录数据；结果在有效期内复用；不存在返回 404', async () => {
    const { LiveToolsService } = await import('../src/api/modules/entities/live-tools.ts')
    const calls: string[] = []
    const remoteServers = new FakeRepository<'server'>([
      draft('server', { slug: 'r', name: 'R', repoUrl: 'https://github.com/a/r', config: '{"mcpServers":{"r":{"type":"http","url":"https://r.example.com/mcp"}}}' }),
    ])
    const service = new EntityService('server', remoteServers, PRESENTERS.server)
    const live = new LiveToolsService(service, async (url) => {
      calls.push(url)
      return { tools: [] }
    })
    const liveApp = createApp({ entities: { server: service }, liveTools: live, logger: silent })
    const first = (await (await liveApp.request('/api/servers/r/tools/live')).json()) as { data: { tools: unknown[] } }
    await liveApp.request('/api/servers/r/tools/live')
    expect(first.data.tools).toEqual([])
    expect(calls).toEqual(['https://r.example.com/mcp'])
    expect((await liveApp.request('/api/servers/nope/tools/live')).status).toBe(404)
  })

  it('拒绝 http、内网和本机地址', async () => {
    const { assertPublicHttps } = await import('../src/probe/mcp-remote.ts')
    await expect(assertPublicHttps('http://example.com/mcp')).rejects.toThrow(/https/)
    await expect(assertPublicHttps('https://127.0.0.1/mcp')).rejects.toThrow(/内网/)
    await expect(assertPublicHttps('https://192.168.1.5/mcp')).rejects.toThrow(/内网/)
    await expect(assertPublicHttps('https://[::1]/mcp')).rejects.toThrow(/内网/)
    await expect(assertPublicHttps('https://10.0.0.8:8443/mcp')).rejects.toThrow(/内网/)
  })
})

describe('图标转存', () => {
  it('有转存地址时替换图标，没有时保留原地址', async () => {
    const repo = new FakeRepository<'server'>([
      draft('server', { slug: 'a', name: 'A', repoUrl: 'https://github.com/x/a', iconUrl: 'https://cdn.mcp.so/a.png' }),
      draft('server', { slug: 'b', name: 'B', repoUrl: 'https://github.com/x/b', iconUrl: 'https://cdn.mcp.so/b.png' }),
    ])
    const assets = { lookup: async () => new Map([['https://cdn.mcp.so/a.png', 'https://assets.mcpfield.com/icons/aa/a.webp']]) }
    const app2 = createApp({ entities: { server: new EntityService('server', repo, PRESENTERS.server, { assets }) }, logger: silent })
    const list = (await (await app2.request('/api/servers')).json()) as { data: { slug: string; iconUrl: string }[] }
    expect(Object.fromEntries(list.data.map((i) => [i.slug, i.iconUrl]))).toEqual({ a: 'https://assets.mcpfield.com/icons/aa/a.webp', b: 'https://cdn.mcp.so/b.png' })
    const detail = (await (await app2.request('/api/servers/a')).json()) as { data: { iconUrl: string } }
    expect(detail.data.iconUrl).toBe('https://assets.mcpfield.com/icons/aa/a.webp')
  })
})

describe('自己撰写的内容', () => {
  it('没有简介的条目用生成的简介；Loop 详情返回目标、退出条件和步骤', async () => {
    const repo = new FakeRepository<'loop'>([draft('loop', { slug: 'ci', name: 'CI', category: 'CI', type: 'interval', maxIterations: 5, checkCommand: 'gh run list' })])
    const generated = {
      taglines: async (_k: string, ids: string[], locale: string) => new Map(ids.map((id) => [id, `${locale}:${id} tagline`])),
      playbook: async () => ({ locale: 'zh' as const, goal: '目标', exitCondition: '退出', steps: [{ position: 0, title: '检查', body: null, command: 'gh run list' }] }),
    }
    const app3 = createApp({ entities: { loop: new EntityService('loop', repo, PRESENTERS.loop, { generated }) }, logger: silent })
    const list = (await (await app3.request('/api/loops?locale=zh')).json()) as { data: { tagline: string; taglineLocale: string }[] }
    expect(list.data[0]).toMatchObject({ tagline: 'zh:ci tagline', taglineLocale: 'zh' })
    const detail = (await (await app3.request('/api/loops/ci?locale=zh')).json()) as { data: Record<string, unknown> }
    expect(detail.data).toMatchObject({ checkCommand: 'gh run list', playbook: { goal: '目标', exitCondition: '退出', steps: [{ title: '检查', command: 'gh run list' }] } })
  })
})
