import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Translate, X } from '@phosphor-icons/react'
import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { useI18n, useLocaleSwitch } from '../i18n/context'
import { detectBrowserLocale, DISMISS_KEY, LOCALE_META, PREF_KEY, type Locale } from '../i18n/locales'
import { messages } from '../i18n/messages'
import { useStorage } from '../lib/storage'

const noop = () => () => {}

/**
 * 访问语言与偏好或浏览器语言不一致时，用推荐语言给出提示。
 * 只在浏览器里判断（服务端渲染时不显示），不做自动跳转，避免影响爬虫和分享链接。
 */
function useSuggestedLocale(current: Locale): Locale | null {
  const [pref] = useStorage(PREF_KEY)
  const [dismissed] = useStorage(DISMISS_KEY)
  const browser = useSyncExternalStore(noop, detectBrowserLocale, () => null)
  const target = pref && pref in LOCALE_META ? (pref as Locale) : browser
  if (!target || target === current || dismissed === `${current}->${target}`) return null
  return target
}

export function LocaleBanner() {
  const { locale } = useI18n()
  const switchTo = useLocaleSwitch()
  const [, setDismissed] = useStorage(DISMISS_KEY)
  const target = useSuggestedLocale(locale)
  const show = !!target
  const t = target ? messages[target].langBanner : null

  return (
    <AnimatePresence initial={false}>
      {show && t && (
        <motion.div
          key={target}
          lang={LOCALE_META[target].htmlLang}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden border-b border-accent/15"
          style={{ background: 'linear-gradient(90deg, #0E7A5C33, #2B7FFF26)' }}
        >
          <div className="mx-auto flex max-w-[1248px] items-center gap-3 px-6 py-2 text-sm">
            <Translate size={15} className="shrink-0 text-accent" />
            <span className="flex-1 truncate text-ink/90">{t.text}</span>
            <Link to={switchTo(target)} className="group flex shrink-0 items-center gap-1 font-medium text-[#9FF0CB] hover:text-white">
              {t.switch}
              <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button
              aria-label={t.dismiss}
              onClick={() => {
                setDismissed(`${locale}->${target}`)
              }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-text2 hover:bg-white/10 hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
