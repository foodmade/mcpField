import { describe, expect, it } from 'vitest'
import { entryUrls, INDEXNOW_BATCH, INDEXNOW_ENDPOINT, submitUrls } from '../src/seo/indexnow.ts'

const config = { key: 'abc123', siteUrl: 'https://mcpfield.com' }

describe('entryUrls', () => {
  it('三种语言的详情页地址：中文没有前缀', () => {
    expect(entryUrls(config.siteUrl, 'server', 'FalkorDB-MCPServer')).toEqual([
      'https://mcpfield.com/servers/FalkorDB-MCPServer',
      'https://mcpfield.com/en/servers/FalkorDB-MCPServer',
      'https://mcpfield.com/ja/servers/FalkorDB-MCPServer',
    ])
    expect(entryUrls(config.siteUrl, 'cli', 'gh')[0]).toBe('https://mcpfield.com/cli/gh')
  })

  it('不能直接放进路径的 slug 不推', () => {
    expect(entryUrls(config.siteUrl, 'server', 'https://github.com/x/y')).toEqual([])
  })
})

describe('submitUrls', () => {
  const fakeFetch = (status: number) => {
    const bodies: { host: string; key: string; keyLocation: string; urlList: string[] }[] = []
    const fn = (async (url: string, init: RequestInit) => {
      expect(url).toBe(INDEXNOW_ENDPOINT)
      bodies.push(JSON.parse(init.body as string))
      return new Response('', { status })
    }) as unknown as typeof fetch
    return { fn, bodies }
  }

  it('按协议上限分批，带上 host、key 和密钥文件地址', async () => {
    const { fn, bodies } = fakeFetch(202)
    const urls = Array.from({ length: INDEXNOW_BATCH + 1 }, (_, i) => `https://mcpfield.com/servers/s${i}`)
    expect(await submitUrls(urls, config, fn)).toEqual([202, 202])
    expect(bodies.map((b) => b.urlList.length)).toEqual([INDEXNOW_BATCH, 1])
    expect(bodies[0]).toMatchObject({ host: 'mcpfield.com', key: 'abc123', keyLocation: 'https://mcpfield.com/abc123.txt' })
  })

  it('非 2xx 抛错', async () => {
    await expect(submitUrls(['https://mcpfield.com/servers/a'], config, fakeFetch(403).fn)).rejects.toThrow('IndexNow 返回 403')
  })
})
