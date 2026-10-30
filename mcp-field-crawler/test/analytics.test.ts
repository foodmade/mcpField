import { describe, expect, it } from 'vitest'
import { beijingDay, classifyPath, isBot, parseUa, sourceOf } from '../src/analytics/classify.ts'
import { botOf, parseLine } from '../src/analytics/crawlers.ts'
import type { AnalyticsCollector, PageView } from '../src/analytics/collector.ts'
import { collectRoutes } from '../src/api/modules/analytics/collect.routes.ts'

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

describe('beijingDay', () => {
  it('按北京时间分天：UTC 16:00 已是第二天', () => {
    expect(beijingDay(new Date('2026-10-18T15:59:59Z'))).toBe('2026-10-18')
    expect(beijingDay(new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-19')
  })
})

describe('classifyPath', () => {
  it('识别语言前缀和页面类型，去掉查询参数和结尾斜杠', () => {
    expect(classifyPath('/')).toEqual({ path: '/', page: 'home', locale: 'zh' })
    expect(classifyPath('/en')).toEqual({ path: '/en', page: 'home', locale: 'en' })
    expect(classifyPath('/servers?category=dev-tools')).toEqual({ path: '/servers', page: 'servers', locale: 'zh' })
    expect(classifyPath('/ja/servers/firecrawl-firecrawl/')).toEqual({ path: '/ja/servers/firecrawl-firecrawl', page: 'servers/*', locale: 'ja' })
    expect(classifyPath('/blog/hello#top')).toEqual({ path: '/blog/hello', page: 'blog/*', locale: 'zh' })
  })

  it('接口、静态资源、不是路径的地址不算', () => {
    expect(classifyPath('/api/collect')).toBeNull()
    expect(classifyPath('/assets/x.js')).toBeNull()
    expect(classifyPath('/sitemap.xml')).toBeNull()
    expect(classifyPath('https://evil.com/')).toBeNull()
    expect(classifyPath('/' + 'a'.repeat(600))).toBeNull()
  })
})

describe('sourceOf', () => {
  it('取来源域名，去掉 www；本站和无效地址算直接访问', () => {
    expect(sourceOf('https://www.google.com/', 'mcpfield.com')).toBe('google.com')
    expect(sourceOf('https://github.com/foo/bar', 'mcpfield.com')).toBe('github.com')
    expect(sourceOf('https://mcpfield.com/servers', 'mcpfield.com')).toBe('')
    expect(sourceOf('https://admin.mcpfield.com/', 'mcpfield.com')).toBe('')
    expect(sourceOf('not a url', 'mcpfield.com')).toBe('')
    expect(sourceOf(undefined, 'mcpfield.com')).toBe('')
  })
})

describe('isBot / parseUa', () => {
  it('爬虫、脚本和空 UA 算爬虫', () => {
    expect(isBot(GOOGLEBOT)).toBe(true)
    expect(isBot('curl/8.7.1')).toBe(true)
    expect(isBot('Mozilla/5.0 (compatible; GoogleOther)')).toBe(true)
    expect(isBot('')).toBe(true)
    expect(isBot(CHROME_MAC)).toBe(false)
    expect(isBot(IPHONE)).toBe(false)
  })

  it('桌面版浏览器主版本过旧的算爬虫，手机上的不按版本判断', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36')).toBe(true)
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe(true)
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0')).toBe(true)
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0')).toBe(false)
    expect(isBot('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 Mobile Safari/537.36')).toBe(false)
  })

  it('设备、浏览器、系统', () => {
    expect(parseUa(CHROME_MAC)).toEqual({ device: 'desktop', browser: 'Chrome', os: 'macOS' })
    expect(parseUa(IPHONE)).toEqual({ device: 'mobile', browser: 'Safari', os: 'iOS' })
    expect(parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0')).toEqual({ device: 'desktop', browser: 'Edge', os: 'Windows' })
    expect(parseUa('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36').device).toBe('tablet')
  })
})

describe('POST /api/collect', () => {
  const setup = () => {
    const views: PageView[] = []
    const collector = { record: async (v: PageView) => (views.push(v), true) } as unknown as AnalyticsCollector
    return { views, app: collectRoutes(collector) }
  }
  const post = (app: ReturnType<typeof setup>['app'], body: string, headers: Record<string, string> = {}) =>
    app.request('/', { method: 'POST', body, headers: { 'content-type': 'text/plain', 'user-agent': CHROME_MAC, 'cf-connecting-ip': '1.2.3.4', 'cf-ipcountry': 'CN', ...headers } })

  it('记下路径、来源、IP、UA、国家，返回 204', async () => {
    const { app, views } = setup()
    const res = await post(app, JSON.stringify({ p: '/servers', r: 'https://google.com/', e: true }))
    expect(res.status).toBe(204)
    expect(views).toEqual([{ path: '/servers', referrer: 'https://google.com/', entry: true, ip: '1.2.3.4', ua: CHROME_MAC, country: 'CN' }])
  })

  it('不合法的请求也返回 204，但不记录；请求体过大返回 413', async () => {
    const { app, views } = setup()
    expect((await post(app, 'not json')).status).toBe(204)
    expect((await post(app, JSON.stringify({ p: 123 }))).status).toBe(204)
    expect(views).toHaveLength(0)
    expect((await post(app, JSON.stringify({ p: '/', r: 'x'.repeat(5000) }))).status).toBe(413)
  })
})

describe('爬虫日志', () => {
  const line = (ua: string, status = 200, time = '15/Oct/2026:09:52:33 +0800') => `162.159.110.156 - - [${time}] "GET /servers/ugcfy-ai HTTP/2.0" ${status} 25313 "-" "${ua}"`

  it('解析 combined 格式：日期（日志时间就是北京时间）、状态码、UA', () => {
    expect(parseLine(line(GOOGLEBOT, 502, '01/Nov/2026:23:59:59 +0800'))).toEqual({ day: '2026-11-01', status: 502, ua: GOOGLEBOT })
    expect(parseLine('garbage')).toBeNull()
  })

  it('识别常见爬虫：GoogleOther、图片爬虫不算进 Googlebot；普通浏览器不算', () => {
    expect(botOf(GOOGLEBOT)).toBe('googlebot')
    expect(botOf('Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.52 Mobile Safari/537.36 (compatible; GoogleOther)')).toBe('googleother')
    expect(botOf('Googlebot-Image/1.0')).toBe('googlebot-image')
    expect(botOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36')).toBe('bingbot')
    expect(botOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toBe('gptbot')
    expect(botOf('Mozilla/5.0 (compatible; SomeNewBot/1.0)')).toBe('other')
    expect(botOf(CHROME_MAC)).toBeNull()
  })
})
