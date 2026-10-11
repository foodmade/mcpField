import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, type LinksFunction } from 'react-router'
import geistMonoLatin from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url'
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
// 中日文用系统字体（苹方、微软雅黑、Hiragino、Yu Gothic 等），不再打包 Noto 网页字体：它的 @font-face 会让首屏 CSS 大 6 倍
import './index.css'
import { ErrorPage } from './components/ErrorPage'
import { SiteShell } from './components/SiteShell'
import { LOCALE_META, stripLocale } from './i18n/locales'
import { THEME_SCRIPT } from './lib/theme'

/** 预加载拉丁字符的两个可变字体，避免首屏先用系统字体渲染、字体到达后再整体位移（CLS） */
export const links: LinksFunction = () => [
  { rel: 'preload', href: interLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
  { rel: 'preload', href: geistMonoLatin, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
]

/** 文档骨架：<html lang> 跟随 URL 里的语言，页面级的 title / meta 由各页面的 <Seo> 输出 */
export function Layout({ children }: { children: ReactNode }) {
  const { locale } = stripLocale(useLocation().pathname)
  return (
    // data-theme 由下面的内联脚本在水合前设置，服务端渲染的 HTML 里没有，所以忽略这处差异
    <html lang={LOCALE_META[locale].htmlLang} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0A0B0D" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://assets.mcpfield.com" crossOrigin="" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Outlet />
    </MotionConfig>
  )
}

/** 兜底：站点布局之外的错误（正常情况下由布局路由或页面自己的 ErrorBoundary 处理） */
export function ErrorBoundary() {
  const { locale } = stripLocale(useLocation().pathname)
  return (
    <SiteShell locale={locale}>
      <ErrorPage />
    </SiteShell>
  )
}
