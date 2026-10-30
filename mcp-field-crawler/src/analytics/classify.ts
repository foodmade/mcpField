/*
 * 访问统计的纯函数：北京时间的日期、页面类型、来源域名、User-Agent 解析（爬虫判断、设备、浏览器、系统）。
 * 浏览器、系统只分常见的几类，够看分布即可，不引入完整的 UA 解析库。
 */

/** 北京时间的日期 YYYY-MM-DD（统计按北京时间分天，与后台一致） */
export const beijingDay = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

const LOCALES = ['en', 'ja'] as const

/**
 * 路径归类：去掉查询参数和结尾斜杠，识别语言前缀；页面类型取第一段路径，带下一级的是详情页（servers/*）。
 * 不是站内页面的地址（接口、静态资源、过长的路径）返回 null
 */
export function classifyPath(raw: string): { path: string; page: string; locale: string } | null {
  const path = raw.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/'
  if (!path.startsWith('/') || path.length > 512 || /^\/(api|assets|sitemaps?)(\/|\.|$)/.test(path)) return null
  const segs = path.split('/').filter(Boolean)
  const locale = (LOCALES as readonly string[]).includes(segs[0] ?? '') ? segs.shift()! : 'zh'
  const page = segs.length === 0 ? 'home' : segs.length === 1 ? segs[0]! : `${segs[0]}/*`
  return { path, page: page.slice(0, 32), locale }
}

/** 来源域名：去掉 www.；本站（含子域名）和无效地址算直接访问（空字符串） */
export function sourceOf(referrer: string | undefined, siteHost: string): string {
  if (!referrer) return ''
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    if (!host || host === siteHost || host.endsWith(`.${siteHost}`)) return ''
    return host.slice(0, 255)
  } catch {
    return ''
  }
}

/** 爬虫、监控、脚本：不计入访问（它们一般不执行 JS，这里是第二道过滤） */
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|preview|python|curl|wget|httpclient|okhttp|java\/|go-http|node-fetch|axios|undici|facebookexternalhit|embedly|googleother|google-inspectiontool|chrome-lighthouse|phantomjs|puppeteer|playwright/i

/**
 * 桌面版 Chrome / Edge / Firefox 会自动更新，主版本低于这个数（2024 年初以前的版本）的几乎都是伪造的 UA：
 * 2026-10-30 有爬虫用住宅代理、带 Chrome 116–120 / Firefox 120–121 的 UA 执行页面 JS，一天刷出 4000 多个访客，
 * 平时真实访客基本是最近几个版本。手机、平板上的 WebView 可能长期不更新，不按版本判断
 */
const MIN_DESKTOP_MAJOR = 122
const DESKTOP_VERSION = /(?:Chrome|Edg|Firefox)\/(\d+)\./g

function isOutdatedDesktop(ua: string): boolean {
  if (/Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(ua)) return false
  return [...ua.matchAll(DESKTOP_VERSION)].some((m) => Number(m[1]) < MIN_DESKTOP_MAJOR)
}

export const isBot = (ua: string) => !ua || BOT.test(ua) || isOutdatedDesktop(ua)

export interface UaInfo {
  device: 'mobile' | 'tablet' | 'desktop'
  browser: string
  os: string
}

export function parseUa(ua: string): UaInfo {
  const device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua) ? 'mobile' : 'desktop'
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung'
        : /MicroMessenger/.test(ua)
          ? 'WeChat'
          : /Quark/.test(ua)
            ? 'Quark'
            : /Firefox|FxiOS/.test(ua)
              ? 'Firefox'
              : /Chrome|CriOS/.test(ua)
                ? 'Chrome'
                : /Safari/.test(ua)
                  ? 'Safari'
                  : 'Other'
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other'
  return { device, browser, os }
}
