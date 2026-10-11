import { HttpError, RobotsDisallowedError } from '../core/errors.ts'
import type { Fetcher } from '../core/source.ts'
import type { FetchMiddleware } from './compose.ts'

interface Rule {
  allow: boolean
  pattern: string
  regex: RegExp
}

export interface RobotsRules {
  groups: { agents: string[]; rules: Rule[] }[]
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + body + (anchored ? '$' : ''))
}

/** 解析 robots.txt（支持 * 通配和 $ 结尾锚定） */
export function parseRobots(text: string): RobotsRules {
  const groups: RobotsRules['groups'] = []
  let current: RobotsRules['groups'][number] | undefined
  let lastWasAgent = false

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }))
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current || (key !== 'allow' && key !== 'disallow')) continue
    if (key === 'disallow' && value === '') continue
    current.rules.push({ allow: key === 'allow', pattern: value, regex: toRegex(value) })
  }
  return { groups }
}

/** 按 Google 的规则判断：选最匹配的 User-Agent 组，取最长匹配规则，同长度时 Allow 优先 */
export function isAllowed(rules: RobotsRules, pathWithQuery: string, userAgent: string): boolean {
  const token = userAgent.split(/[/\s]/)[0]!.toLowerCase()
  const group =
    rules.groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a))) ??
    rules.groups.find((g) => g.agents.includes('*'))
  if (!group) return true

  let best: Rule | undefined
  for (const rule of group.rules) {
    if (!rule.regex.test(pathWithQuery)) continue
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule
    }
  }
  return best ? best.allow : true
}

async function loadRobots(next: Fetcher, origin: string): Promise<RobotsRules> {
  try {
    const doc = await next.fetch({ url: `${origin}/robots.txt` })
    return parseRobots(doc.body)
  } catch (error) {
    // 4xx：站点没有 robots.txt，视为全部允许；其他错误向上抛，稍后重试
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) return { groups: [] }
    throw error
  }
}

/** 抓取前检查 robots.txt，每个站点只下载一次 */
export function withRobots(options: { userAgent: string }): FetchMiddleware {
  const cache = new Map<string, Promise<RobotsRules>>()

  return (next) => ({
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== '/robots.txt') {
        let rules = cache.get(url.origin)
        if (!rules) {
          rules = loadRobots(next, url.origin)
          cache.set(url.origin, rules)
          rules.catch(() => cache.delete(url.origin))
        }
        if (!isAllowed(await rules, url.pathname + url.search, options.userAgent)) {
          throw new RobotsDisallowedError(request.url)
        }
      }
      return next.fetch(request)
    },
  })
}
