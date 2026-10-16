import { withLocale, type Locale } from '../i18n/locales'

/** 正式站点地址：canonical、hreflang、sitemap、结构化数据都用绝对地址 */
export const SITE = 'https://mcpfield.com'

export const OG_LOCALE: Record<Locale, string> = { zh: 'zh_CN', en: 'en_US', ja: 'ja_JP' }

/** 页面在某个语言下的绝对地址；path 是不带语言前缀的路径 */
export const absoluteUrl = (locale: Locale, path: string, query = '') => `${SITE}${withLocale(locale, path)}${query ? `?${query}` : ''}`

/** 描述截断到约 155 个字符，按词或标点断开 */
export function clip(text: string | null | undefined, max = 155): string | null {
  if (!text) return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('、'))
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,，。、;；:：—–-]+$/, '')}…`
}

/**
 * 详情页标题「名称 · 栏目 · MCP Field」控制在 70 个字符内（超出会被搜索引擎截断，Bing 站长工具也会报警告）：
 * 放不下就去掉栏目，还放不下就截短名称
 */
export function detailTitle(name: string, section: string, max = 70): string {
  const brand = ' · MCP Field'
  const full = `${name} · ${section}${brand}`
  if (full.length <= max) return full
  if (name.length + brand.length <= max) return `${name}${brand}`
  // clip 末尾可能多出一个省略号，预留 1 个字符
  return `${clip(name, max - brand.length - 1)}${brand}`
}
