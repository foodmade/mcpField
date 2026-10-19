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

/**
 * 在 <head> 里最先同步执行：打开无前缀（中文）地址时，按已保存的语言选择、没有时按浏览器语言（同 detectBrowserLocale）
 * 直接换到对应语言的地址，避免非中文用户先看到中文页。只在浏览器里做——页面 HTML 经 Cloudflare 缓存，服务端按
 * Accept-Language 跳转会被缓存串掉；爬虫不跳，保证中文页正常收录；带 /en、/ja 前缀的地址是明确指定的语言，不跳。
 */
export const LOCALE_REDIRECT_SCRIPT = `(function(){try{var p=location.pathname;if(/^\\/(en|ja)(\\/|$)/.test(p)||/bot|crawl|spider|slurp|lighthouse|headless/i.test(navigator.userAgent))return;var t=null;try{t=localStorage.getItem('${PREF_KEY}')}catch(e){}if(t!=='zh'&&t!=='en'&&t!=='ja'){t='en';var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<ls.length;i++){var s=(ls[i]||'').toLowerCase();if(s.indexOf('zh')===0){t='zh';break}if(s.indexOf('ja')===0){t='ja';break}if(s.indexOf('en')===0){t='en';break}}}if(t==='zh')return;document.documentElement.style.display='none';location.replace('/'+t+(p==='/'?'':p)+location.search+location.hash)}catch(e){}})()`
