import { describe, expect, it } from 'vitest'
import { buildConfig, serverKey, type ServerInfo } from './config.js'
import { agentFromClient, installArgs, riskyAudits, skillSource } from './skills.js'

const local: ServerInfo = {
  slug: 'firecrawl-firecrawl',
  name: 'firecrawl',
  links: { repository: 'https://github.com/firecrawl/firecrawl' },
  packages: [{ registryType: 'npm', identifier: 'firecrawl-mcp' }],
  envVars: [{ name: 'FIRECRAWL_API_KEY', description: 'API key', required: true, secret: true }],
  remotes: [],
}

describe('get_mcp_config', () => {
  it('本地服务：各客户端的写法', () => {
    expect(buildConfig(local, 'claude-code')!.config).toBe('claude mcp add firecrawl-firecrawl --scope user --env FIRECRAWL_API_KEY=<FIRECRAWL_API_KEY> -- npx -y firecrawl-mcp')
    expect(buildConfig(local, 'codex')!.config).toBe('[mcp_servers.firecrawl-firecrawl]\ncommand = "npx"\nargs = ["-y", "firecrawl-mcp"]\nenv = { FIRECRAWL_API_KEY = "<FIRECRAWL_API_KEY>" }')
    expect(JSON.parse(buildConfig(local, 'gemini-cli')!.config)).toEqual({ mcpServers: { 'firecrawl-firecrawl': { command: 'npx', args: ['-y', 'firecrawl-mcp'], env: { FIRECRAWL_API_KEY: '<FIRECRAWL_API_KEY>' } } } })
    expect(JSON.parse(buildConfig(local, 'vscode')!.config).servers['firecrawl-firecrawl'].type).toBe('stdio')
    expect(buildConfig(local, 'cursor')).toMatchObject({ mode: 'local', unverifiedPackage: false, envVars: local.envVars })
  })

  it('有远程地址时优先用远程；sse 与 http 分开', () => {
    const remote = { ...local, remotes: [{ transport: 'streamable-http', url: 'https://mcp.example.com/mcp' }] }
    expect(buildConfig(remote, 'claude-code')!.config).toBe('claude mcp add --scope user --transport http firecrawl-firecrawl https://mcp.example.com/mcp')
    expect(buildConfig(remote, 'codex')!.config).toBe('[mcp_servers.firecrawl-firecrawl]\nurl = "https://mcp.example.com/mcp"')
    expect(JSON.parse(buildConfig(remote, 'gemini-cli')!.config).mcpServers['firecrawl-firecrawl']).toEqual({ httpUrl: 'https://mcp.example.com/mcp' })
    expect(JSON.parse(buildConfig({ ...remote, remotes: [{ transport: 'sse', url: 'https://x/sse' }] }, 'gemini-cli')!.config).mcpServers['firecrawl-firecrawl']).toEqual({ url: 'https://x/sse' })
    expect(JSON.parse(buildConfig(remote, 'claude-desktop')!.config).mcpServers['firecrawl-firecrawl'].args).toEqual(['-y', 'mcp-remote', 'https://mcp.example.com/mcp'])
  })

  it('pypi 用 uvx；没有安装包也没有地址时返回 null；包名对不上时提醒核对', () => {
    expect(buildConfig({ ...local, packages: [{ registryType: 'pypi', identifier: 'mcp-server-firecrawl' }], envVars: [] }, 'cursor')!.config).toContain('"uvx"')
    expect(buildConfig({ ...local, packages: [] }, 'cursor')).toBeNull()
    expect(buildConfig({ ...local, packages: [{ registryType: 'npm', identifier: '@slack/mcp-slack' }] }, 'cursor')!.unverifiedPackage).toBe(true)
    expect(serverKey('@Foo/Bar Baz')).toBe('foo-bar-baz')
  })
})

describe('install_skill', () => {
  it('从安装命令里取来源和 Skill 名，没有命令时用仓库和 skillSlug', () => {
    expect(skillSource({ installCommand: 'npx skills add https://github.com/vercel-labs/skills --skill find-skills', links: { repository: null } })).toEqual({ source: 'https://github.com/vercel-labs/skills', skill: 'find-skills' })
    expect(skillSource({ installCommand: null, skillSlug: 'pdf', links: { repository: 'https://github.com/anthropics/skills' } })).toEqual({ source: 'https://github.com/anthropics/skills', skill: 'pdf' })
    expect(skillSource({ installCommand: null, links: { repository: null } })).toBeNull()
  })

  it('命令行参数：每个 Agent 一个 --agent，全局时加 --global', () => {
    expect(installArgs({ source: 'o/r', skill: 's' }, ['claude-code', 'codex'], true)).toEqual(['-y', 'skills', 'add', 'o/r', '--skill', 's', '--agent', 'claude-code', '--agent', 'codex', '--global', '--yes'])
    expect(installArgs({ source: 'o/r', skill: 's' }, ['cursor'], false)).not.toContain('--global')
  })

  it('按客户端名称认出 Agent；审计没通过或高风险的要确认', () => {
    expect(agentFromClient('claude-code')).toBe('claude-code')
    expect(agentFromClient('codex-mcp-client')).toBe('codex')
    expect(agentFromClient('gemini-cli-mcp-client')).toBe('gemini-cli')
    expect(agentFromClient('claude-ai')).toBeNull()
    expect(agentFromClient('something-else')).toBeNull()
    expect(riskyAudits([{ auditor: 'a', result: 'pass' }, { auditor: 'b', result: 'warn', riskLevel: 'HIGH' }, { auditor: 'c', result: 'fail' }]).map((a) => a.auditor)).toEqual(['b', 'c'])
  })
})
