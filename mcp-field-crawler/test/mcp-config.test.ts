import { describe, expect, it } from 'vitest'
import { parseMcpServersConfig } from '../src/extract/mcp-config.ts'
import { toToolDrafts } from '../src/extract/mcp-tools.ts'

describe('parseMcpServersConfig', () => {
  it('npx / uvx / docker 分别识别为 npm / PyPI / OCI 包，只保留环境变量名', () => {
    const parsed = parseMcpServersConfig({
      mcpServers: {
        a: { command: 'npx', args: ['-y', '@scope/server@1.2.0'], env: { API_KEY: 'real-secret', REGION: 'us' } },
        b: { command: 'uvx', args: ['--from', 'mcp-server-x==0.3', 'mcp-server-x'] },
        c: { command: 'docker', args: ['run', '-i', '--rm', '-e', 'GITHUB_TOKEN', 'ghcr.io/org/image:latest'] },
      },
    })
    expect(parsed.packages).toEqual([
      { registryType: 'npm', identifier: '@scope/server', runtimeHint: 'npx', transport: 'stdio' },
      { registryType: 'pypi', identifier: 'mcp-server-x', runtimeHint: 'uvx', transport: 'stdio' },
      { registryType: 'oci', identifier: 'ghcr.io/org/image:latest', runtimeHint: 'docker', transport: 'stdio' },
    ])
    expect(parsed.envVars).toEqual([
      { name: 'API_KEY', required: true, secret: true },
      { name: 'REGION', required: true, secret: false },
      { name: 'GITHUB_TOKEN', required: true, secret: true },
    ])
    expect(JSON.stringify(parsed)).not.toContain('real-secret')
  })

  it('远程端点', () => {
    const parsed = parseMcpServersConfig({ mcpServers: { r: { type: 'sse', url: 'https://x.dev/sse', headers: { Authorization: 'Bearer t' } } } })
    expect(parsed.remotes).toEqual([{ transport: 'sse', url: 'https://x.dev/sse', authType: 'header' }])
  })

  it('识别第三方代理配置并整体忽略', () => {
    const parsed = parseMcpServersConfig({ mcpServers: { x: { command: 'npx', args: ['-y', 'mcprouter'], env: { SERVER_KEY: 'k' } } } })
    expect(parsed).toEqual({ packages: [], envVars: [], remotes: [], proxied: true })
  })
})

describe('toToolDrafts', () => {
  it('展开嵌套参数并标记必填', () => {
    const [tool] = toToolDrafts([
      {
        name: 'navigate',
        description: 'Open a page',
        inputSchema: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string' },
            options: { type: 'object', required: ['timeout'], properties: { timeout: { type: 'number', default: 30 } } },
          },
        },
      },
      { name: 'navigate' },
      { description: 'no name' },
    ]) as [ReturnType<typeof toToolDrafts>[number]]
    expect(tool.params.map((p) => [p.path, p.jsonType, p.required])).toEqual([
      ['url', 'string', true],
      ['options', 'object', false],
      ['options.timeout', 'number', true],
    ])
  })
})
