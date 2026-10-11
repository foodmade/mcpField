import { describe, expect, it } from 'vitest'
import { isAllowed, parseRobots } from '../src/fetch/robots.ts'

const UA = 'MCPFieldBot/0.1 (+https://mcpfield.dev/bot)'

describe('robots.txt', () => {
  const rules = parseRobots(`
User-agent: *
Disallow: /*?*q=
Disallow: /api/
Disallow: /search
Allow: /api/public

User-agent: BadBot
Disallow: /
`)

  it('详情页允许抓取', () => {
    expect(isAllowed(rules, '/servers/demo', UA)).toBe(true)
  })

  it('禁止的路径和带 q= 的查询', () => {
    expect(isAllowed(rules, '/api/servers', UA)).toBe(false)
    expect(isAllowed(rules, '/search', UA)).toBe(false)
    expect(isAllowed(rules, '/servers?q=github', UA)).toBe(false)
  })

  it('更长的 Allow 规则覆盖 Disallow', () => {
    expect(isAllowed(rules, '/api/public/list', UA)).toBe(true)
  })

  it('按 User-Agent 选择规则组', () => {
    expect(isAllowed(rules, '/servers/demo', 'BadBot/1.0')).toBe(false)
  })

  it('$ 结尾锚定', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.json$')
    expect(isAllowed(r, '/a.json', UA)).toBe(false)
    expect(isAllowed(r, '/a.json?x=1', UA)).toBe(true)
  })
})
