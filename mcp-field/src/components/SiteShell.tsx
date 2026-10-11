import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useNavigation } from 'react-router'
import { I18nProvider } from '../i18n/context'
import type { Locale } from '../i18n/locales'
import { Footer } from './Footer'
import { Nav } from './Nav'

/** 站内跳转时顶部的加载进度条（页面数据在服务端加载期间显示） */
function NavigationProgress() {
  const navigation = useNavigation()
  if (navigation.state === 'idle') return null
  return (
    <motion.div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gradient-to-r from-accent to-blue"
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 0.85 }}
      transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }}
    />
  )
}

/** 站点外壳：语言上下文、导航、页脚 */
export function SiteShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nProvider locale={locale}>
      <NavigationProgress />
      <Nav />
      <main>{children}</main>
      <Footer />
    </I18nProvider>
  )
}
