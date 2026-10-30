import { describe, expect, it } from 'vitest'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import type { EntityDraft, ServerDetailDraft, SkillAuditDraft } from '../src/core/draft.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import { hasBrokenName, mergeDrafts, pickPrimary } from '../src/merge/merge-drafts.ts'
import type { MergeItem } from '../src/merge/plan.ts'
import { assignSlugs, bulkDraftIds, capSourceCreatedAt, contentChangedAt, contentHash } from '../src/merge/publish.ts'

const detail = (over: Partial<ServerDetailDraft> = {}): ServerDetailDraft => ({ isRemote: false, transports: [], packages: [], envVars: [], remotes: [], tools: [], ...over })

/** mcp.so 条目：有分类、标签、工具、星数，安装配置被换成了代理（没有安装包） */
function mcpso(slug: string, over: Partial<ServerDetailDraft> = {}) {
  return new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: slug, sourceUrl: `https://mcp.so/server/${slug}`, slug, name: 'Acme Weather' }, detail(over))
    .identity({ repository: parseRepositoryUrl('https://github.com/acme/mcp-servers') })
    .text('tagline', 'en', 'Weather from mcp.so')
    .text('readme', 'en', '# old snapshot', 'markdown')
    .category('weather-cat', 'Weather')
    .tags(['weather'])
    .metric('github_stars', 120)
    .link('repository', 'https://github.com/acme/mcp-servers')
    .author({ platform: 'github', login: 'acme', role: 'owner' })
    .set('sourceCreatedAt', '2026-03-01T00:00:00.000Z')
    .issue('proxied_install_config', 'mcprouter')
}

/** 官方 Registry 条目：仓库带子目录、有安装包和远程端点、有图标，没有分类 */
function registry() {
  return new DraftBuilder(
    { kind: 'server', sourceId: 'mcp-registry', externalId: 'io.github.acme/weather', sourceUrl: 'https://registry/x', slug: 'acme-weather', name: 'weather' },
    detail({
      isRemote: true,
      transports: ['stdio', 'streamable-http'],
      packages: [{ registryType: 'npm', identifier: '@acme/weather' }],
      envVars: [{ name: 'ACME_KEY', required: true, secret: true }],
      remotes: [{ transport: 'streamable-http', url: 'https://mcp.acme.dev/mcp', authType: 'bearer' }],
    }),
  )
    .identity({ registryName: 'io.github.acme/weather', repository: parseRepositoryUrl('https://github.com/acme/mcp-servers/tree/main/weather'), npmPackage: '@acme/weather' })
    .text('tagline', 'en', 'Weather from the registry')
    .tags(['forecast', 'weather'])
    .media('icon', 'https://acme.dev/icon.png')
    .link('npm', 'https://www.npmjs.com/package/@acme/weather')
    .author({ platform: 'github', login: 'acme', role: 'publisher' })
    .set('sourceCreatedAt', '2026-09-01T00:00:00.000Z')
    .set('sourceUpdatedAt', '2026-10-01T00:00:00.000Z')
}

describe('pickPrimary', () => {
  it('mcp.so 优先；同来源里不带随机后缀、slug 短的优先', () => {
    const m = (sourceId: string, slug: string) => ({ sourceId, externalId: slug, slug })
    expect(pickPrimary([m('mcp-registry', 'a'), m('mcpso', 'firecrawl-6afd09'), m('mcpso', 'firecrawl-firecrawl'), m('mcpso', 'firecrawl')]).slug).toBe('firecrawl')
    expect(pickPrimary([m('mcp-registry', 'b'), m('mcp-registry', 'a')]).slug).toBe('a')
  })
})

describe('mergeDrafts', () => {
  const so = mcpso('acme-weather', { tools: [{ name: 'forecast', params: [] }] }).build() as EntityDraft
  const reg = registry().build() as EntityDraft
  const merged = mergeDrafts([reg, so], { primary: so, slug: 'acme-weather', identityKey: 'repo:github.com/acme/mcp-servers/weather' })

  it('主条目决定来源、地址；身份合并：仓库取更具体的子目录，Registry 名称和包名补上', () => {
    expect(merged).toMatchObject({ sourceId: 'mcpso', externalId: 'acme-weather', slug: 'acme-weather', identityKey: 'repo:github.com/acme/mcp-servers/weather', name: 'Acme Weather' })
    expect(merged.identity).toEqual({
      repository: { host: 'github.com', owner: 'acme', name: 'mcp-servers', path: 'weather' },
      registryName: 'io.github.acme/weather',
      npmPackage: '@acme/weather',
    })
    expect(merged.repository).toEqual(merged.identity.repository)
  })

  it('展示类字段 mcp.so 优先、缺的从 Registry 补；源站 README 不进入结果', () => {
    expect(merged.texts).toEqual([{ field: 'tagline', locale: 'en', content: 'Weather from mcp.so', format: 'plain' }])
    expect(merged.categories).toEqual([{ slug: 'weather-cat', sourceValue: 'Weather', primary: true }])
    expect(merged.tags).toEqual(['weather', 'forecast'])
    expect(merged.media).toEqual([{ type: 'icon', url: 'https://acme.dev/icon.png' }])
    expect(merged.links.map((l) => l.type)).toEqual(['repository', 'npm', 'source', 'source'])
    // 每个来源的条目地址都记为 source 链接，label 是数据源 ID
    expect(merged.links.filter((l) => l.type === 'source').map((l) => l.label)).toEqual(['mcpso', 'mcp-registry'])
    expect(merged.authors.map((a) => a.role)).toEqual(['owner', 'publisher'])
    expect(merged.metrics.map((m) => [m.metric, m.value])).toEqual([['github_stars', 120]])
    expect(merged).toMatchObject({ sourceCreatedAt: '2026-03-01T00:00:00.000Z', sourceUpdatedAt: '2026-10-01T00:00:00.000Z' })
  })

  it('安装信息取 Registry 的，工具列表取最多的那个来源', () => {
    expect(merged.detail).toMatchObject({
      isRemote: true,
      transports: ['stdio', 'streamable-http'],
      packages: [{ registryType: 'npm', identifier: '@acme/weather' }],
      envVars: [{ name: 'ACME_KEY' }],
      remotes: [{ url: 'https://mcp.acme.dev/mcp' }],
      tools: [{ name: 'forecast' }],
    })
  })

  it('不修改输入；主条目的问题保留，有了仓库就去掉"缺少仓库"', () => {
    expect(so.texts.some((t) => t.field === 'readme')).toBe(true)
    expect(merged.issues.map((i) => i.code)).toEqual(['proxied_install_config'])
  })

  it('mcp.so 的重复条目：原来的地址记为旧 slug', () => {
    const dup = mcpso('acme-weather-6afd09').build() as EntityDraft
    const result = mergeDrafts([dup, so, reg], { primary: so, slug: 'acme-weather', identityKey: 'k' })
    expect(result.aliases).toEqual([{ type: 'previous_slug', value: 'acme-weather-6afd09' }])
  })

  /** mcp.so 名称填成了提交者的人名，且被映射器标记为可疑 */
  const misnamed = (name: string, repo: string) =>
    new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: 'x', sourceUrl: 'u', slug: 'x', name }, detail())
      .identity({ repository: parseRepositoryUrl(`https://github.com/${repo}`) })
      .author({ platform: 'github', login: 'someone', displayName: 'Umut Naci', role: 'owner' })
      .issue('suspicious_name', name)
      .build() as EntityDraft

  it('名称填错：等于作者人名或有重复词、且与仓库没有共同词才算；与仓库有共同词的不算', () => {
    expect(hasBrokenName(misnamed('Umut Naci', 'firecrawl/firecrawl-mcp-server'))).toBe(true)
    expect(hasBrokenName(misnamed('Slack Slack', 'microsoft/playwright-mcp'))).toBe(true)
    expect(hasBrokenName(misnamed('Getting Started', 'copilotkit/mcp-client'))).toBe(true)
    expect(hasBrokenName(misnamed('Belgian Train Schedule', 'hansf/irail-mcp'))).toBe(false)
    expect(hasBrokenName(misnamed('PayPal', 'paypal/agent-toolkit'))).toBe(false)
    expect(hasBrokenName(misnamed('Gemini Docs MCP Server', 'm-gonzalo/cosa-sai'))).toBe(false)
  })

  it('名称填错：不超过两个有效词、且 README 里没提到；描述性长名称和没有 README 的不算', () => {
    const vscode = (name: string, readme?: string) => {
      const b = new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: 'vscode', sourceUrl: 'u', slug: 'vscode', name }, detail())
        .identity({ repository: parseRepositoryUrl('https://github.com/microsoft/vscode') })
        .issue('suspicious_name', name)
      if (readme) b.text('readme', 'en', readme, 'markdown')
      return b.build() as EntityDraft
    }
    const readme = '# Visual Studio Code - Open Source ("Code - OSS")\n\nThis repository is where we develop the Visual Studio Code product.'
    expect(hasBrokenName(vscode('Geng', readme))).toBe(true)
    expect(hasBrokenName(vscode('Geng'), readme)).toBe(true)
    expect(hasBrokenName(vscode('Geng'))).toBe(false)
    expect(hasBrokenName(vscode('Code OSS', readme))).toBe(false)
    expect(hasBrokenName(vscode('Geng'), 'Thanks to Geng for the logo.')).toBe(false)
    expect(hasBrokenName(vscode('Belgian Train Schedule', readme))).toBe(false)
    const generic = new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: 'x', sourceUrl: 'u', slug: 'x', name: 'Perplexity Ask' }, detail())
      .identity({ repository: parseRepositoryUrl('https://github.com/ppl-ai/modelcontextprotocol') })
      .issue('suspicious_name', 'Perplexity Ask')
      .build() as EntityDraft
    expect(hasBrokenName(generic, readme)).toBe(false)
    const so = vscode('Geng')
    expect(mergeDrafts([so], { primary: so, slug: 'vscode', identityKey: 'k', readme }).name).toBe('vscode')
  })

  it('名称填错时用其他来源的名称，没有时用仓库名（monorepo 取子目录名）', () => {
    const broken = misnamed('Umut Naci', 'acme/mcp-servers/tree/main/weather')
    expect(mergeDrafts([broken, reg], { primary: broken, slug: 'x', identityKey: 'k' }).name).toBe('weather')
    expect(mergeDrafts([broken], { primary: broken, slug: 'x', identityKey: 'k' }).name).toBe('weather')
    const root = misnamed('Umut Naci', 'firecrawl/firecrawl-mcp-server')
    expect(mergeDrafts([root], { primary: root, slug: 'x', identityKey: 'k' }).name).toBe('firecrawl-mcp-server')
  })

  it('只有一个成员时等同于原草稿（去掉源站 README，加上来源链接）', () => {
    const single = mergeDrafts([reg], { primary: reg, slug: 'acme-weather', identityKey: 'registry:io.github.acme/weather' })
    expect({ ...single, identityKey: reg.identityKey, links: single.links.filter((l) => l.type !== 'source') }).toEqual(reg)
    expect(single.links.at(-1)).toEqual({ type: 'source', url: reg.sourceUrl, label: 'mcp-registry' })
  })
})

describe('mergeDrafts（Skill）', () => {
  const skill = (sourceId: string, audits: SkillAuditDraft[], files?: string[]) =>
    new DraftBuilder({ kind: 'skill', sourceId, externalId: `${sourceId}-pdf`, sourceUrl: `https://${sourceId}/pdf`, slug: 'pdf', name: 'pdf' }, { canonicalKey: 'anthropics/skills#pdf', audits, ...(files ? { files } : {}) })
      .identity({ skillKey: 'anthropics/skills#pdf' })
      .build() as EntityDraft

  it('审计取信息最全的来源，文件列表从有的来源补上', () => {
    const so = skill('mcpso', [{ auditor: 'Socket', result: 'pass' }, { auditor: 'Snyk', result: 'warn' }])
    const sh = skill('skills-sh', [{ auditor: 'Socket', result: 'pass', riskLevel: 'SAFE', summary: 'No alerts' }], ['scripts/merge.py'])
    const merged = mergeDrafts([sh, so], { primary: so, slug: 'pdf', identityKey: 'skill:anthropics/skills#pdf' })
    expect(merged.detail).toMatchObject({ canonicalKey: 'anthropics/skills#pdf', audits: [{ auditor: 'Socket', riskLevel: 'SAFE' }], files: ['scripts/merge.py'] })
  })
})

describe('capSourceCreatedAt', () => {
  const withCreated = (at?: string) => ({ sourceCreatedAt: at }) as EntityDraft

  it('上架日期晚于首次发现（源站发了新版本）时改成首次发现的时间', () => {
    const d = withCreated('2026-10-29T01:54:59.114Z')
    capSourceCreatedAt(d, new Date('2026-10-12T03:31:42.713Z'))
    expect(d.sourceCreatedAt).toBe('2026-10-12T03:31:42.713Z')
  })

  it('上架日期早于首次发现、没有上架日期或不知道发现时间的不变', () => {
    const d = withCreated('2026-10-29T08:59:43.210Z')
    capSourceCreatedAt(d, new Date('2026-10-29T11:36:56.049Z'))
    expect(d.sourceCreatedAt).toBe('2026-10-29T08:59:43.210Z')
    const none = withCreated()
    capSourceCreatedAt(none, new Date('2026-10-12T00:00:00Z'))
    expect(none.sourceCreatedAt).toBeUndefined()
    const unknown = withCreated('2026-10-29T08:59:43.210Z')
    capSourceCreatedAt(unknown, null)
    expect(unknown.sourceCreatedAt).toBe('2026-10-29T08:59:43.210Z')
  })
})

describe('bulkDraftIds', () => {
  const item = (id: number, repo: string | undefined, kind: MergeItem['kind'] = 'server'): MergeItem => ({
    draftId: id,
    sourceId: 'mcp-registry',
    kind,
    externalId: `x/${id}`,
    slug: `x-${id}`,
    name: 'x',
    identity: repo ? { repository: parseRepositoryUrl(`https://github.com/${repo}`) } : {},
  })

  it('同一仓库目录登记超过上限的判定为凑数；monorepo 的不同子目录、其他类型不算', () => {
    const items = [
      ...[1, 2, 3].map((id) => item(id, 'spam/utils')),
      ...[4, 5, 6].map((id) => item(id, `awslabs/mcp/tree/main/src/s${id}`)),
      ...[7, 8, 9].map((id) => item(id, 'acme/skills', 'skill')),
      item(10, undefined),
    ]
    expect([...bulkDraftIds(items, 2)].sort()).toEqual([1, 2, 3])
  })
})

describe('assignSlugs', () => {
  const req = (key: string, sourceId: string, slug: string) => ({ kind: 'server' as const, key, primary: { sourceId, externalId: slug, slug } })

  it('mcp.so 先保住自己的地址，其他来源重名时加序号', () => {
    const a = req('k1', 'mcp-registry', 'weather')
    const b = req('k2', 'mcpso', 'weather')
    const c = req('k3', 'mcp-registry', 'weather')
    const slugs = assignSlugs([a, b, c], [])
    expect([slugs.get(a), slugs.get(b), slugs.get(c)]).toEqual(['weather-2', 'weather', 'weather-3'])
  })

  it('上一次发布过的沿用原地址：按身份键，其次按主条目', () => {
    const a = req('k1', 'mcp-registry', 'weather')
    const b = req('k2-new', 'mcpso', 'weather')
    const previous = [
      { kind: 'server' as const, identityKey: 'k1', sourceId: 'mcp-registry', externalId: 'weather', slug: 'weather' },
      { kind: 'server' as const, identityKey: 'k2-old', sourceId: 'mcpso', externalId: 'weather', slug: 'weather-2' },
    ]
    const slugs = assignSlugs([a, b], previous)
    expect([slugs.get(a), slugs.get(b)]).toEqual(['weather', 'weather-2'])
  })

  it('只差大小写的地址算重名（数据库比较不区分大小写）', () => {
    const a = req('k1', 'mcpso', 'basicMcpServer')
    const b = req('k2', 'mcpso', 'BasicMcpServer')
    const slugs = assignSlugs([a, b], [])
    expect([slugs.get(a), slugs.get(b)]).toEqual(['basicMcpServer', 'BasicMcpServer-2'])
  })
})

describe('contentHash', () => {
  const base = () => mcpso('acme-weather').build() as EntityDraft

  it('源站更新时间、最近提交时间、星数和质量问题变了不算内容变化', () => {
    const changed = mcpso('acme-weather').set('sourceUpdatedAt', '2026-10-10T15:14:33.667Z').set('lastCommitAt', '2026-10-13T00:00:00Z').metric('github_stars', 999).issue('suspicious_name', 'x').build() as EntityDraft
    expect(contentHash(changed)).toBe(contentHash(base()))
  })

  it('简介、README 变了算内容变化', () => {
    const tagline = mcpso('acme-weather').text('tagline', 'zh', '天气').build() as EntityDraft
    expect(contentHash(tagline)).not.toBe(contentHash(base()))
    expect(contentHash(base(), 'readme-v2')).not.toBe(contentHash(base(), 'readme-v1'))
  })

  it('Skill 只是重新审计（审计时间变了、结果没变）不算内容变化', () => {
    const skill = (auditedAt: string, result: SkillAuditDraft['result'] = 'pass') =>
      new DraftBuilder({ kind: 'skill', sourceId: 'skills-sh', externalId: 'pdf', sourceUrl: 'https://skills.sh/pdf', slug: 'pdf', name: 'pdf' }, { audits: [{ auditor: 'Socket', result, auditedAt }] }).build() as EntityDraft
    expect(contentHash(skill('2026-10-14'))).toBe(contentHash(skill('2026-09-01')))
    expect(contentHash(skill('2026-10-14', 'fail'))).not.toBe(contentHash(skill('2026-09-01')))
  })
})

describe('contentChangedAt', () => {
  const now = new Date('2026-10-15T00:00:00Z')
  const before = new Date('2025-04-06T00:00:00Z')

  it('新条目记为本次发布时间；内容没变沿用上一次的，变了记为本次发布时间', () => {
    expect(contentChangedAt(undefined, 'h1', now)).toBe(now)
    expect(contentChangedAt({ contentHash: 'h1', contentChangedAt: before }, 'h1', now)).toBe(before)
    expect(contentChangedAt({ contentHash: 'h1', contentChangedAt: before }, 'h2', now)).toBe(now)
  })

  it('上一次还没记哈希（迁移后第一次发布）沿用迁移时的初始值，没有初始值的仍为空', () => {
    expect(contentChangedAt({ contentHash: null, contentChangedAt: before }, 'h1', now)).toBe(before)
    expect(contentChangedAt({ contentHash: null, contentChangedAt: null }, 'h1', now)).toBeNull()
  })
})
