import { describe, expect, it } from 'vitest'
import { identityKey, parseRepositoryUrl } from '../src/core/identity.ts'

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
    expect(identityKey({ remoteUrl: 'https://mcp.example.com/mcp/' })).toBe('remote:mcp.example.com/mcp')
    expect(identityKey({ website: 'https://www.example.com/' })).toBe('site:example.com')
    expect(identityKey({})).toBeNull()
  })
})
