export const LOCALES = ['zh', 'en', 'ja'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh'

export const LOCALE_META: Record<Locale, { label: string; htmlLang: string; prefix: string }> = {
  zh: { label: '简体中文', htmlLang: 'zh-CN', prefix: '' },
  en: { label: 'English', htmlLang: 'en', prefix: '/en' },
  ja: { label: '日本語', htmlLang: 'ja', prefix: '/ja' },
}

// 缺失翻译的回退顺序：日文 → 英文 → 中文；英文 → 中文
export const FALLBACK: Record<Locale, Locale[]> = { zh: ['zh'], en: ['en', 'zh'], ja: ['ja', 'en', 'zh'] }

/** 多语言文本：[中文, 英文?, 日文?] */
export type L = readonly [zh: string, en?: string, ja?: string]
const IDX: Record<Locale, number> = { zh: 0, en: 1, ja: 2 }
export const tr = (text: L, locale: Locale) => {
  for (const l of FALLBACK[locale]) {
    const v = text[IDX[l]]
    if (v) return v
  }
  return text[0]
}

/** 路由参数 :lang → 语言；中文没有前缀，所以 /zh 和未知前缀都不合法（返回 null） */
export function localeFromParam(lang: string | undefined): Locale | null {
  if (lang === undefined) return DEFAULT_LOCALE
  return lang === 'en' || lang === 'ja' ? lang : null
}

export function stripLocale(pathname: string): { locale: Locale; rest: string } {
  for (const l of LOCALES) {
    const p = LOCALE_META[l].prefix
    if (p && (pathname === p || pathname.startsWith(p + '/'))) return { locale: l, rest: pathname.slice(p.length) || '/' }
  }
  return { locale: DEFAULT_LOCALE, rest: pathname || '/' }
}

export const withLocale = (locale: Locale, to: string) => {
  const p = LOCALE_META[locale].prefix
  if (!to.startsWith('/')) return to
  return p + (to === '/' && p ? '' : to) || '/'
}

/** 根据浏览器语言推断推荐语言：按浏览器偏好顺序取第一个支持的，都不支持时用英文 */
export function detectBrowserLocale(): Locale {
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const s = (l || '').toLowerCase()
    if (s.startsWith('zh')) return 'zh'
    if (s.startsWith('ja')) return 'ja'
    if (s.startsWith('en')) return 'en'
  }
  return 'en'
}

export const PREF_KEY = 'mcpfield.locale'
export const DISMISS_KEY = 'mcpfield.localeBannerDismissed'
