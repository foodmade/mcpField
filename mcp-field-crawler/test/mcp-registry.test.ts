import { describe, expect, it } from 'vitest'
import type { Fetcher } from '../src/core/source.ts'
import type { CrawlTarget, FetchRequest, RawDocument } from '../src/core/types.ts'
import { PrefetchFetcher } from '../src/fetch/prefetch.ts'
import { RegistryDiscoverer } from '../src/sources/mcp-registry/discoverer.ts'
import { displayName, pickIcon, publisherOf, registrySlug, RegistryServerMapper } from '../src/sources/mcp-registry/mapper.ts'
import { RegistryServerParser } from '../src/sources/mcp-registry/parser.ts'
import { listUrl, serverUrl } from '../src/sources/mcp-registry/urls.ts'

const official = (updatedAt: string, status = 'active') => ({
  'io.modelcontextprotocol.registry/official': { status, publishedAt: '2026-09-30T02:38:24.149981Z', updatedAt, isLatest: true },
})

/** 2026-10 实测条目（ai.agent-bev/bev-door）基础上补了环境变量、请求头、多个图标 */
const ENTRY = {
  server: {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: 'io.github.Acme/weather',
    description: 'Weather forecasts for any city.',
    title: 'Acme Weather',
    repository: { url: 'https://github.com/acme/mcp-servers', source: 'github', subfolder: 'servers/weather/' },
    version: '0.2.5',
    websiteUrl: 'https://acme.dev',
    icons: [
      { src: 'https://acme.dev/icon-dark.svg', mimeType: 'image/svg+xml', sizes: ['any'], theme: 'dark' },
      { src: 'https://acme.dev/icon-64.png', mimeType: 'image/png', sizes: ['64x64'] },
      { src: 'https://acme.dev/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] },
    ],
    packages: [
      {
        registryType: 'npm',
        identifier: '@acme/weather-mcp',
        version: '0.2.5',
        transport: { type: 'stdio' },
        environmentVariables: [
          { name: 'ACME_API_KEY', description: 'API key', isRequired: true, isSecret: true, default: 'should-not-be-stored' },
          { name: 'ACME_UNITS', description: 'metric or imperial', default: 'metric' },
          { name: 'ACME_TOKEN', default: 'also-not-stored' },
        ],
      },
      { registryType: 'pypi', identifier: 'acme-weather', transport: { type: 'stdio' } },
    ],
    remotes: [
      { type: 'streamable-http', url: 'https://{tenant}.acme.dev/mcp' },
      { type: 'sse', url: 'https://mcp.acme.dev/sse', headers: [{ name: 'Authorization', description: 'Bearer token', isSecret: true }] },
    ],
    _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { tags: ['Weather', 'Forecast'], keywords: ['climate'], categories: ['data'] } },
  },
  _meta: official('2026-10-01T08:00:00.123456Z'),
}

const doc = (url: string, body: string): RawDocument => ({ requestedUrl: url, url, status: 200, headers: {}, body, fetchedAt: new Date('2026-10-12T00:00:00Z'), durationMs: 0, notModified: false })
const target = (name: string): CrawlTarget => ({ sourceId: 'mcp-registry', kind: 'server', externalId: name, url: serverUrl(name) })

async function mapEntry(entry: unknown) {
  const [record] = await new RegistryServerParser().parse(doc(serverUrl('x'), JSON.stringify(entry)), target('io.github.Acme/weather'))
  return new RegistryServerMapper().map(record!)
}

describe('RegistryDiscoverer', () => {
  const entry = (name: string, updatedAt = '2026-10-01T00:00:00Z') => ({ server: { name, description: name }, _meta: official(updatedAt) })
  const PAGES: Record<string, unknown> = {
    [listUrl()]: { servers: [entry('a/one'), entry('a/two')], metadata: { nextCursor: 'a/two:1.0.0', count: 2 } },
    [listUrl({ cursor: 'a/two:1.0.0' })]: { servers: [entry('a/two'), entry('b/three', 'not a date')], metadata: { count: 2 } },
  }

  function setup() {
    const requested: string[] = []
    const inner: Fetcher = {
      async fetch(req: FetchRequest) {
        requested.push(req.url)
        if (!(req.url in PAGES)) throw new Error('unexpected ' + req.url)
        return doc(req.url, JSON.stringify(PAGES[req.url]))
      },
    }
    return { requested, fetcher: new PrefetchFetcher(inner) }
  }

  it('按游标翻页，跨页重复的只出一次；lastmod 取 Registry 的更新时间，无效的不带', async () => {
    const { fetcher, requested } = setup()
    const targets: CrawlTarget[] = []
    for await (const t of new RegistryDiscoverer(fetcher, 'mcp-registry').discover({ kinds: ['server'] })) targets.push(t)
    expect(targets.map((t) => t.externalId)).toEqual(['a/one', 'a/two', 'b/three'])
    expect(targets[0]).toMatchObject({ url: 'https://registry.modelcontextprotocol.io/v0.1/servers/a%2Fone/versions/latest', lastmod: new Date('2026-10-01T00:00:00Z') })
    expect(targets[2]!.lastmod).toBeUndefined()
    expect(requested).toHaveLength(2)
  })

  it('列表条目预取给抓取器：抓取详情不再发请求，内容就是 { server, _meta }', async () => {
    const { fetcher, requested } = setup()
    for await (const t of new RegistryDiscoverer(fetcher, 'mcp-registry').discover({ kinds: ['server'], limitPerKind: 1 })) {
      const fetched = await fetcher.fetch({ url: t.url })
      expect(JSON.parse(fetched.body)).toEqual(entry('a/one'))
      expect(fetched.fetchedAt).toEqual(new Date('2026-10-12T00:00:00Z'))
    }
    expect(requested).toEqual([listUrl()])
  })

  it('不要服务类型时什么都不请求；since 转成 updated_since', async () => {
    const { fetcher, requested } = setup()
    for await (const _ of new RegistryDiscoverer(fetcher, 'mcp-registry').discover({ kinds: ['skill'] })) throw new Error('不应产出')
    expect(requested).toEqual([])
    expect(listUrl({ since: new Date('2026-10-11T00:00:00Z') })).toContain('updated_since=2026-10-11T00%3A00%3A00.000Z')
  })
})

describe('PrefetchFetcher', () => {
  it('取过一次就删除；超过容量淘汰最早放入的；没预取的交给下层', async () => {
    const calls: string[] = []
    const prefetch = new PrefetchFetcher({ fetch: async (r) => (calls.push(r.url), doc(r.url, 'inner')) }, 2)
    prefetch.prime('u1', 'b1', new Date())
    prefetch.prime('u2', 'b2', new Date())
    prefetch.prime('u3', 'b3', new Date())
    expect((await prefetch.fetch({ url: 'u3' })).body).toBe('b3')
    expect((await prefetch.fetch({ url: 'u3' })).body).toBe('inner')
    expect((await prefetch.fetch({ url: 'u1' })).body).toBe('inner')
    expect((await prefetch.fetch({ url: 'u2' })).body).toBe('b2')
    expect(calls).toEqual(['u3', 'u1'])
  })
})

describe('RegistryServerParser', () => {
  it('不是 JSON 或缺少 server.name 时报解析错误', async () => {
    const parser = new RegistryServerParser()
    await expect(parser.parse(doc('u', '<html>'), target('x'))).rejects.toThrow('不是合法的 JSON')
    await expect(parser.parse(doc('u', '{"server":{}}'), target('x'))).rejects.toThrow('数据结构不符合预期')
  })
})

describe('RegistryServerMapper', () => {
  it('身份线索：Registry 名称、仓库 + 子目录、npm、PyPI、第一个不带模板的远程地址、官网', async () => {
    const draft = (await mapEntry(ENTRY))!
    expect(draft.identity).toEqual({
      registryName: 'io.github.Acme/weather',
      repository: { host: 'github.com', owner: 'acme', name: 'mcp-servers', path: 'servers/weather' },
      npmPackage: '@acme/weather-mcp',
      pypiPackage: 'acme-weather',
      remoteUrl: 'https://mcp.acme.dev/sse',
      website: 'https://acme.dev',
    })
    expect(draft.identityKey).toBe('repo:github.com/acme/mcp-servers/servers/weather')
  })

  it('基本字段、作者、标签、图标、链接', async () => {
    const draft = (await mapEntry(ENTRY))!
    expect(draft).toMatchObject({
      kind: 'server',
      sourceId: 'mcp-registry',
      externalId: 'io.github.Acme/weather',
      slug: 'acme-weather',
      name: 'Acme Weather',
      sourceCreatedAt: '2026-09-30T02:38:24.149Z',
      sourceUpdatedAt: '2026-10-01T08:00:00.123Z',
      texts: [{ field: 'tagline', locale: 'en', content: 'Weather forecasts for any city.', format: 'plain' }],
      authors: [{ platform: 'github', login: 'Acme', url: 'https://github.com/Acme', role: 'publisher' }],
      tags: ['weather', 'forecast', 'climate'],
      media: [{ type: 'icon', url: 'https://acme.dev/icon-512.png' }],
      categories: [],
    })
    expect(draft.links.map((l) => l.type)).toEqual(['repository', 'website', 'npm', 'pypi'])
  })

  it('安装包、环境变量（机密的不留默认值）、远程端点与鉴权方式', async () => {
    const { detail } = (await mapEntry(ENTRY))! as unknown as { detail: Record<string, unknown> }
    expect(detail).toMatchObject({ isRemote: true, runtime: 'node', version: '0.2.5', transports: ['stdio', 'streamable-http', 'sse'], tools: [] })
    expect(detail.packages).toEqual([
      { registryType: 'npm', identifier: '@acme/weather-mcp', version: '0.2.5', transport: 'stdio' },
      { registryType: 'pypi', identifier: 'acme-weather', transport: 'stdio' },
    ])
    expect(detail.envVars).toEqual([
      { name: 'ACME_API_KEY', description: 'API key', required: true, secret: true },
      { name: 'ACME_UNITS', description: 'metric or imperial', required: false, secret: false, defaultValue: 'metric' },
      { name: 'ACME_TOKEN', required: false, secret: true },
    ])
    expect(detail.remotes).toEqual([
      { transport: 'streamable-http', url: 'https://{tenant}.acme.dev/mcp', authType: 'unknown' },
      { transport: 'sse', url: 'https://mcp.acme.dev/sse', authType: 'bearer' },
    ])
  })

  it('只有远程端点、没有标题和仓库的服务', async () => {
    const draft = (await mapEntry({ server: { name: 'ac.inference.sh/mcp', description: 'Run AI apps', remotes: [{ type: 'streamable-http', url: 'https://api.inference.sh/mcp' }] }, _meta: official('2026-10-01T00:00:00Z') }))!
    expect(draft).toMatchObject({ name: 'sh', slug: 'ac-inference-sh-mcp', identityKey: 'registry:ac.inference.sh/mcp' })
    expect(draft.authors).toEqual([{ platform: 'website', login: 'sh.inference.ac', url: 'https://sh.inference.ac', role: 'publisher' }])
    expect(draft.issues).toEqual([{ code: 'missing_repository' }])
    expect(draft.detail).toMatchObject({ isRemote: true, packages: [], envVars: [] })
  })

  it('已删除的不生成草稿', async () => {
    expect(await mapEntry({ ...ENTRY, _meta: official('2026-10-01T00:00:00Z', 'deleted') })).toBeNull()
  })
})

describe('辅助函数', () => {
  it('显示名：title 优先；名称最后一段是通用词时用账号或域名主体', () => {
    expect(displayName({ name: 'io.github.acme/weather', title: 'Acme Weather' })).toBe('Acme Weather')
    expect(displayName({ name: 'io.github.acme/weather' })).toBe('weather')
    expect(displayName({ name: 'com.409acost/site' })).toBe('409acost')
    expect(displayName({ name: 'ai.agentgates/MCP' })).toBe('agentgates')
    expect(displayName({ name: 'io.github.cyanheads/mcp-server' })).toBe('cyanheads')
  })

  it('slug、发布者、图标选择', () => {
    expect(registrySlug('io.github.github/github-mcp-server')).toBe('github-github-mcp-server')
    expect(publisherOf('br.com.empresa/x')).toMatchObject({ platform: 'website', login: 'empresa.com.br' })
    expect(pickIcon([{ src: 'dark.svg', theme: 'dark', sizes: ['any'] }, { src: 'light.svg', sizes: ['any'] }])).toBe('light.svg')
    expect(pickIcon([])).toBeUndefined()
  })
})
