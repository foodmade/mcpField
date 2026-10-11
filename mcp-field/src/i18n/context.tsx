import { createContext, useContext, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { PREF_KEY, stripLocale, tr, withLocale, type L, type Locale } from './locales'
import { messages, type Messages } from './messages'

type Ctx = { locale: Locale; m: Messages; tr: (t: L) => string; to: (path: string) => string }
const I18nCtx = createContext<Ctx | null>(null)

/** <html lang> 由 root 根据 URL 直接输出 */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nCtx.Provider value={{ locale, m: messages[locale], tr: (t) => tr(t, locale), to: (p) => withLocale(locale, p) }}>
      {children}
    </I18nCtx.Provider>
  )
}

export function useI18n() {
  const c = useContext(I18nCtx)
  if (!c) throw new Error('useI18n 必须在 I18nProvider 内使用')
  return c
}

/** 切换语言时保留当前页面、查询参数与锚点 */
export function useLocaleSwitch() {
  const loc = useLocation()
  return (target: Locale) => {
    localStorage.setItem(PREF_KEY, target)
    const { rest } = stripLocale(loc.pathname)
    return withLocale(target, rest) + loc.search + loc.hash
  }
}
