import { describe, expect, it } from 'vitest'
import { identityKey, identityKeys, npmKey, parseRepositoryUrl, pypiKey, remoteKey } from '../src/core/identity.ts'

describe('parseRepositoryUrl', () => {
  it('统一大小写、去掉 .git 和末尾斜杠', () => {
    expect(parseRepositoryUrl('https://www.GitHub.com/Microsoft/Playwright-MCP.git/')).toEqual({
      host: 'github.com',
      owner: 'microsoft',
      name: 'playwright-mcp',
      path: '',
    })
  })

  it('保留 monorepo 子目录，丢弃分支名', () => {
    expect(parseRepositoryUrl('https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem')?.path).toBe('src/filesystem')
  })

  it('支持 git+https 和 SSH 写法', () => {
    expect(parseRepositoryUrl('git+https://github.com/a/b.git')?.name).toBe('b')
    expect(parseRepositoryUrl('git@github.com:a/b.git')?.owner).toBe('a')
  })

  it('非代码托管站点返回 undefined', () => {
    expect(parseRepositoryUrl('https://example.com/a/b')).toBeUndefined()
    expect(parseRepositoryUrl('not a url')).toBeUndefined()
  })
})

describe('identityKey', () => {
  it('同一 monorepo 下的不同子目录得到不同的键', () => {
    const a = identityKey({ repository: parseRepositoryUrl('https://github.com/x/servers/tree/main/src/git') })
    const b = identityKey({ repository: parseRepositoryUrl('https://github.com/x/servers/tree/main/src/time') })
    expect(a).not.toBe(b)
  })

  it('Skill 键优先于仓库，避免同仓库的多个 Skill 被合并', () => {
    const repository = parseRepositoryUrl('https://github.com/anthropics/skills')
    expect(identityKey({ skillKey: 'anthropics/skills#PDF', repository })).toBe('skill:anthropics/skills#pdf')
  })

  it('没有仓库时依次退回到 npm、远程地址、官网', () => {
    expect(identityKey({ npmPackage: '@Scope/Pkg', website: 'https://a.dev' })).toBe('npm:@scope/pkg')
    expect(identityKey({ remoteUrl: 'https://mcp.acme.dev/mcp/' })).toBe('remote:mcp.acme.dev/mcp')
    expect(identityKey({ website: 'https://www.acme.dev/' })).toBe('site:acme.dev')
    expect(identityKey({})).toBeNull()
  })

  it('镜像仓库 mcp-mirror/<owner>_<repo> 归到原仓库', () => {
    expect(identityKey({ repository: parseRepositoryUrl('https://github.com/mcp-mirror/antvis_mcp-server-chart') })).toBe('repo:github.com/antvis/mcp-server-chart')
    expect(identityKey({ repository: parseRepositoryUrl('https://github.com/mcp-mirror/plain') })).toBe('repo:github.com/mcp-mirror/plain')
  })
})

describe('单个键的规范化与排除', () => {
  it('npm：去掉版本，拒绝启动器和不合规的包名', () => {
    expect(npmKey('@Scope/Pkg@1.2.3')).toBe('npm:@scope/pkg')
    expect(npmKey('pkg@latest')).toBe('npm:pkg')
    for (const launcher of ['mcp-remote', '@smithery/cli', 'nx', '@modelcontextprotocol/inspector', 'tsx']) expect(npmKey(launcher)).toBeUndefined()
    expect(npmKey('./build/index.js')).toBeUndefined()
    expect(npmKey('github:user/repo')).toBeUndefined()
  })

  it('PyPI：按 PEP 503 归一化，去掉版本，拒绝 git 地址和启动器', () => {
    expect(pypiKey('Foo_Bar.baz')).toBe('pypi:foo-bar-baz')
    expect(pypiKey('awslabs.bedrock-kb-retrieval-mcp-server@latest')).toBe('pypi:awslabs-bedrock-kb-retrieval-mcp-server')
    expect(pypiKey('mcp-server-time==1.0')).toBe('pypi:mcp-server-time')
    expect(pypiKey('git+https://github.com/a/b')).toBeUndefined()
    expect(pypiKey('run')).toBeUndefined()
  })

  it('远程地址：去掉查询参数，拒绝本机、内网、示例域名和占位写法', () => {
    expect(remoteKey('https://mcp.acme.dev/sse?api_key=secret')).toBe('remote:mcp.acme.dev/sse')
    for (const url of ['http://localhost:3000/mcp', 'http://127.0.0.1:8000/sse', 'http://0.0.0.0/mcp', 'http://192.168.1.2/mcp', 'https://example.com/mcp', 'https://{host}/mcp', 'https://your-domain.com/mcp']) {
      expect(remoteKey(url)).toBeUndefined()
    }
  })
})

describe('identityKeys', () => {
  it('官网是平台首页时不产生键（site:npmjs.com 曾让 14 个服务撞键）', () => {
    expect(identityKeys({ website: 'https://www.npmjs.com' })).toEqual([])
    expect(identityKeys({ website: 'https://smithery.ai/server/x' })).toEqual([])
    expect(identityKeys({ website: 'https://github.com/acme' })).toEqual([])
  })

  it('官网是 npm / PyPI / 仓库页面时转成对应的强键', () => {
    expect(identityKeys({ website: 'https://www.npmjs.com/package/@asklingxi/bazi-mcp' })).toEqual([{ type: 'npm', key: 'npm:@asklingxi/bazi-mcp', strong: true }])
    expect(identityKeys({ website: 'https://pypi.org/project/Mcp_Atlassian/' })).toEqual([{ type: 'pypi', key: 'pypi:mcp-atlassian', strong: true }])
    expect(identityKeys({ website: 'https://github.com/acme/tool' })).toEqual([{ type: 'repo', key: 'repo:github.com/acme/tool', strong: true }])
  })

  it('官网指向的仓库与仓库字段不同时只算弱键', () => {
    const keys = identityKeys({ repository: parseRepositoryUrl('https://github.com/acme/tool'), website: 'https://github.com/other/tool' })
    expect(keys).toEqual([
      { type: 'repo', key: 'repo:github.com/acme/tool', strong: true },
      { type: 'repo', key: 'repo:github.com/other/tool', strong: false },
    ])
  })

  it('有 Skill 键时仓库只算弱键，排在强键之后', () => {
    const keys = identityKeys({ skillKey: 'Acme/Skills#PDF', repository: parseRepositoryUrl('https://github.com/acme/skills'), website: 'https://acme.dev' })
    expect(keys.map((k) => [k.key, k.strong])).toEqual([
      ['skill:acme/skills#pdf', true],
      ['repo:github.com/acme/skills', false],
      ['site:acme.dev', false],
    ])
  })

  it('同时给出全部强键，供跨来源合并', () => {
    const keys = identityKeys({
      repository: parseRepositoryUrl('https://github.com/acme/tool'),
      registryName: 'io.github.acme/tool',
      npmPackage: '@acme/tool',
      pypiPackage: 'acme-tool',
      remoteUrl: 'https://mcp.acme.dev/mcp',
    })
    expect(keys.filter((k) => k.strong).map((k) => k.type)).toEqual(['repo', 'registry', 'npm', 'pypi', 'remote'])
  })
})
