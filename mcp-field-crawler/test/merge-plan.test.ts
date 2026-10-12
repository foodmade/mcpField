import { describe, expect, it } from 'vitest'
import type { IdentityHints } from '../src/core/draft.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import type { EntityKind } from '../src/core/types.ts'
import { planMerge, type MergeItem } from '../src/merge/plan.ts'

let nextId = 1
function item(externalId: string, identity: IdentityHints, kind: EntityKind = 'server', sourceId = 'mcpso'): MergeItem {
  return { draftId: nextId++, sourceId, kind, externalId, name: externalId, identity }
}
const repo = (path: string) => parseRepositoryUrl(`https://github.com/${path}`)
const membersOf = (plan: ReturnType<typeof planMerge>) => plan.groups.map((g) => g.members.map((m) => m.externalId).sort()).sort()

describe('planMerge', () => {
  it('同一仓库的重复条目合并成一组', () => {
    const plan = planMerge([item('charming', { repository: repo('tambo-labs/charming-mcp') }), item('charming-6afd09', { repository: repo('tambo-labs/charming-mcp') })])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.key).toBe('repo:github.com/tambo-labs/charming-mcp')
  })

  it('不同来源通过第二个强键合并：一边只有仓库 + npm，一边只有 Registry 名称 + npm', () => {
    const plan = planMerge([
      item('acme-tool', { repository: repo('acme/tool'), npmPackage: '@acme/tool' }),
      item('io.github.acme/tool', { registryName: 'io.github.acme/tool', npmPackage: '@acme/tool' }, 'server', 'mcp-registry'),
    ])
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0]!.sources.sort()).toEqual(['mcp-registry', 'mcpso'])
    expect(plan.groups[0]!.key).toBe('repo:github.com/acme/tool')
  })

  it('只在同一类型内合并，跨类型记为相关', () => {
    const plan = planMerge([item('prisma', { repository: repo('prisma/prisma') }), item('prisma-cli', { repository: repo('prisma/prisma') }, 'cli')])
    expect(plan.groups).toHaveLength(2)
    expect(plan.related).toEqual([
      {
        key: 'repo:github.com/prisma/prisma',
        entries: [
          { kind: 'server', group: 'repo:github.com/prisma/prisma' },
          { kind: 'cli', group: 'repo:github.com/prisma/prisma' },
        ],
      },
    ])
  })

  it('启动器包、本地地址、平台官网不会把不相关的条目串起来', () => {
    const plan = planMerge([
      item('a', { repository: repo('a/a'), npmPackage: 'mcp-remote', remoteUrl: 'http://localhost:3000/sse', website: 'https://www.npmjs.com' }),
      item('b', { repository: repo('b/b'), npmPackage: 'mcp-remote', remoteUrl: 'http://localhost:3000/sse', website: 'https://www.npmjs.com' }),
      item('c', { npmPackage: '@smithery/cli', website: 'https://www.npmjs.com' }),
      item('d', { npmPackage: '@smithery/cli', website: 'https://www.npmjs.com' }),
    ])
    expect(plan.groups).toHaveLength(4)
    expect(plan.ambiguous).toEqual([])
  })

  it('被多个仓库引用的包有歧义，不用于合并，也不会把没有仓库的条目随便挂到其中一组', () => {
    const plan = planMerge([
      item('official', { repository: repo('modelcontextprotocol/servers/tree/main/src/filesystem'), npmPackage: '@modelcontextprotocol/server-filesystem' }),
      item('tutorial', { repository: repo('someone/my-fs-demo'), npmPackage: '@modelcontextprotocol/server-filesystem' }),
      item('no-repo', { npmPackage: '@modelcontextprotocol/server-filesystem' }),
    ])
    expect(plan.groups).toHaveLength(3)
    expect(plan.ambiguous).toHaveLength(1)
    expect(plan.ambiguous[0]).toMatchObject({ key: 'npm:@modelcontextprotocol/server-filesystem' })
    expect(plan.ambiguous[0]!.reason).toContain('repo 不同')
    expect(plan.ambiguous[0]!.groups).toHaveLength(3)
  })

  it('同一仓库根目录、但包名不同的条目不合并（monorepo 里的两个服务）', () => {
    const plan = planMerge([item('x', { repository: repo('acme/servers'), npmPackage: '@acme/x' }), item('y', { repository: repo('acme/servers'), npmPackage: '@acme/y' })])
    expect(plan.groups).toHaveLength(2)
    // 两组都不能用共用的仓库键做身份，各自用独有的 npm 键
    expect(plan.groups.map((g) => g.key).sort()).toEqual(['npm:@acme/x', 'npm:@acme/y'])
  })

  it('仓库根目录与子目录不冲突：同一个 npm 包的两条记录合并', () => {
    const plan = planMerge([
      item('root', { repository: repo('acme/servers'), npmPackage: '@acme/fs' }),
      item('sub', { repository: repo('acme/servers/tree/main/src/fs'), npmPackage: '@acme/fs' }),
    ])
    expect(plan.groups).toHaveLength(1)
  })

  it('有条目指向子目录时，仓库根目录键不用于合并', () => {
    const plan = planMerge([
      item('collection', { repository: repo('awslabs/mcp') }),
      item('bedrock', { repository: repo('awslabs/mcp'), pypiPackage: 'awslabs.bedrock-kb-retrieval-mcp-server' }),
      item('cdk', { repository: repo('awslabs/mcp/tree/main/src/cdk-mcp-server') }),
    ])
    expect(membersOf(plan)).toEqual([['bedrock'], ['cdk'], ['collection']])
    expect(plan.ambiguous[0]!.reason).toContain('monorepo')
    // 共用的根目录键不能当身份：没有其他强键的一组退回到来源 ID
    expect(plan.groups.map((g) => g.key).sort()).toEqual([
      'pypi:awslabs-bedrock-kb-retrieval-mcp-server',
      'repo:github.com/awslabs/mcp/src/cdk-mcp-server',
      'source:mcpso/server/collection',
    ])
  })

  it('镜像仓库与原仓库合并', () => {
    const plan = planMerge([item('chart', { repository: repo('antvis/mcp-server-chart') }), item('antvis_chart', { repository: repo('mcp-mirror/antvis_mcp-server-chart') })])
    expect(plan.groups).toHaveLength(1)
  })

  it('同一仓库的不同 Skill 不合并', () => {
    const plan = planMerge([
      item('pdf', { skillKey: 'anthropics/skills#pdf', repository: repo('anthropics/skills') }, 'skill'),
      item('docx', { skillKey: 'anthropics/skills#docx', repository: repo('anthropics/skills') }, 'skill'),
    ])
    expect(plan.groups).toHaveLength(2)
    expect(plan.suggestions).toEqual([])
  })

  it('只有官网相同的不合并，只提示可能重复', () => {
    const plan = planMerge([
      item('firecrawl', { repository: repo('firecrawl/firecrawl-mcp-server'), website: 'https://firecrawl.dev' }),
      item('firecrawl-old', { repository: repo('mendableai/firecrawl-mcp-server'), website: 'https://www.firecrawl.dev/' }),
    ])
    expect(plan.groups).toHaveLength(2)
    expect(plan.suggestions).toEqual([
      { kind: 'server', key: 'site:firecrawl.dev', groups: ['repo:github.com/firecrawl/firecrawl-mcp-server', 'repo:github.com/mendableai/firecrawl-mcp-server'] },
    ])
  })

  it('没有任何键的条目单独成组，身份键为 source:来源/类型/ID', () => {
    const plan = planMerge([item('loop-a', {}, 'loop'), item('loop-b', {}, 'loop')])
    expect(plan.groups.map((g) => g.key).sort()).toEqual(['source:mcpso/loop/loop-a', 'source:mcpso/loop/loop-b'])
  })
})
