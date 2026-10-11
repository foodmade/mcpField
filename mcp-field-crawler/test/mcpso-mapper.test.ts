import { describe, expect, it } from 'vitest'
import type { EntityDraftOf } from '../src/core/draft.ts'
import type { EntityKind, SourceRecord } from '../src/core/types.ts'
import { McpSoMapper } from '../src/sources/mcpso/mapper.ts'
import type { McpSoData } from '../src/sources/mcpso/schema.ts'

function record<K extends EntityKind>(kind: K, item: Record<string, unknown>, context: McpSoData['context'] = {}): SourceRecord<McpSoData> {
  return {
    sourceId: 'mcpso',
    kind,
    externalId: String(item.slug),
    url: `https://mcp.so/x/${String(item.slug)}`,
    parserVersion: 1,
    fetchedAt: new Date('2026-10-10T00:00:00Z'),
    data: { item: item as McpSoData['item'], context },
  }
}

const map = <K extends EntityKind>(kind: K, item: Record<string, unknown>, context?: McpSoData['context']) =>
  new McpSoMapper(kind).map(record(kind, item, context)) as EntityDraftOf<K>

describe('McpSoMapper', () => {
  it('MCP 服务：拆出仓库、分类、标签、指标、工具，代理配置记为问题', () => {
    const draft = map(
      'server',
      {
        slug: 'demo-search',
        name: 'Demo Search',
        tagline: 'Search things',
        repoUrl: 'https://github.com/Acme/demo-search',
        authorName: 'Acme',
        authorUrl: 'https://github.com/Acme',
        iconUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        stars: 120,
        tags: '["Search","web search","search"]',
        transports: '["stdio","websocket"]',
        config: '{"mcpServers":{"x":{"command":"npx","args":["-y","mcprouter"],"env":{"SERVER_KEY":"k"}}}}',
        tools: '[{"name":"query","inputSchema":{"type":"object","properties":{"q":{"type":"string"}},"required":["q"]}}]',
        createdAt: '2025-03-31T12:26:35.531Z',
      },
      { categoryName: 'Search', linkableTags: ['web-search'] },
    )

    expect(draft.identityKey).toBe('repo:github.com/acme/demo-search')
    expect(draft.categories).toEqual([{ slug: 'search', sourceValue: 'Search', primary: true }])
    expect(draft.tags).toEqual(['search', 'web-search'])
    expect(draft.metrics).toEqual([expect.objectContaining({ metric: 'github_stars', value: 120, period: 'total' })])
    expect(draft.authors).toEqual([expect.objectContaining({ platform: 'github', login: 'Acme', role: 'owner' })])
    expect(draft.detail.transports).toEqual(['stdio'])
    expect(draft.detail.tools[0]?.params).toEqual([expect.objectContaining({ path: 'q', required: true })])
    expect(draft.detail.packages).toEqual([])
    expect(draft.issues).toEqual([{ code: 'proxied_install_config', detail: 'mcprouter' }])
  })

  it('名称与 slug 对不上时记为可疑名称；未知分类记为问题', () => {
    const draft = map('server', { slug: 'playwright-microsoft', name: 'Slack Slack', repoUrl: 'https://github.com/microsoft/playwright-mcp' }, { categoryName: 'Quantum' })
    expect(draft.issues.map((i) => i.code).sort()).toEqual(['suspicious_name', 'unmapped_category'])
  })

  it('源站的 Other 是已知取值：分类为 null，但不算问题', () => {
    const draft = map('client', { slug: 'x-client', name: 'X Client', repoUrl: 'https://github.com/x/client', category: 'other' })
    expect(draft.categories).toEqual([{ slug: null, sourceValue: 'other', primary: true }])
    expect(draft.issues).toEqual([])
  })

  it('配置里有远程地址的服务算远程服务', () => {
    const draft = map('server', { slug: 'r', name: 'Remote Thing', repoUrl: 'https://github.com/a/r', isRemote: false, config: '{"mcpServers":{"r":{"type":"sse","url":"https://r.example.com/sse"}}}' })
    expect(draft.detail.isRemote).toBe(true)
    expect(draft.detail.remotes).toEqual([{ transport: 'sse', url: 'https://r.example.com/sse', authType: 'unknown' }])
  })

  it('Skill：按 owner/repo#skill 合并，安全审计拆成独立项', () => {
    const draft = map('skill', {
      slug: 'pdf',
      name: 'pdf',
      canonicalKey: 'anthropics/skills#pdf',
      owner: 'anthropics',
      repository: 'skills',
      repositoryUrl: 'https://github.com/anthropics/skills',
      category: 'documents',
      installs: 1000,
      firstSeen: 'Jan 19, 2026',
      securityAudits: ['Gen Agent Trust Hub: Pass', 'Socket: Fail'],
    })
    expect(draft.identityKey).toBe('skill:anthropics/skills#pdf')
    expect(draft.repository).toEqual({ host: 'github.com', owner: 'anthropics', name: 'skills', path: '' })
    expect(draft.detail.firstSeenOn).toBe('2026-01-19')
    expect(draft.detail.audits).toEqual([
      { auditor: 'Gen Agent Trust Hub', result: 'pass' },
      { auditor: 'Socket', result: 'fail' },
    ])
  })

  it('CLI：安装命令识别包管理器，命令别名进入 aliases', () => {
    const draft = map('cli', {
      slug: 'github-cli',
      name: 'GitHub CLI',
      command: 'gh',
      repository: 'cli/cli',
      install: 'brew install gh',
      category: 'developer',
      aliases: ['gh'],
      examples: ['gh auth login'],
    })
    expect(draft.identityKey).toBe('repo:github.com/cli/cli')
    expect(draft.detail.installs).toEqual([{ manager: 'brew', platform: 'macos', command: 'brew install gh' }])
    expect(draft.aliases).toEqual([{ type: 'command', value: 'gh' }])
    expect(draft.categories[0]?.slug).toBe('dev')
  })

  it('CLI：源站没有图标字段，用所有者的 GitHub 头像', () => {
    const draft = map('cli', { slug: 'act', name: 'act', command: 'act', owner: 'nektos', repository: 'nektos/act' })
    expect(draft.media).toEqual([{ type: 'icon', url: 'https://github.com/nektos.png' }])
    expect(map('cli', { slug: 'x', name: 'x', owner: 'not a login' }).media).toEqual([])
  })

  it('Loop：不映射源站撰写的提示词和步骤', () => {
    const draft = map('loop', {
      slug: 'ci-watch',
      name: 'CI Watch',
      category: 'CI',
      type: 'interval',
      maxIterations: 12,
      kickoffPrompt: 'source-authored text',
      supportedAgents: '[{"name":"Cursor","active":true}]',
    })
    expect(JSON.stringify(draft)).not.toContain('source-authored text')
    expect(draft.detail).toMatchObject({ loopType: 'interval', maxIterations: 12, supportedAgents: [{ name: 'Cursor', active: true }] })
    expect(draft.identityKey).toBeNull()
  })
})
