import { data, Outlet, type ShouldRevalidateFunctionArgs } from 'react-router'
import { ErrorPage } from '../components/ErrorPage'
import { SiteShell } from '../components/SiteShell'
import { DEFAULT_LOCALE, localeFromParam } from '../i18n/locales'
import type { Route } from './+types/site'

/** 校验 URL 里的语言前缀：只认 /en、/ja，其余（包括 /zh）返回 404 */
export function loader({ params }: Route.LoaderArgs) {
  if (!localeFromParam(params.lang)) throw data(null, { status: 404 })
  return null
}

// 语言不变时不需要重新校验
export const shouldRevalidate = ({ currentParams, nextParams }: ShouldRevalidateFunctionArgs) => currentParams.lang !== nextParams.lang

export default function Site({ params }: Route.ComponentProps) {
  return (
    <SiteShell locale={localeFromParam(params.lang) ?? DEFAULT_LOCALE}>
      <Outlet />
    </SiteShell>
  )
}

/** 没有自己 ErrorBoundary 的页面出错时，在站点外壳里显示错误页 */
export function ErrorBoundary({ params }: Route.ErrorBoundaryProps) {
  const locale = localeFromParam(params.lang) ?? DEFAULT_LOCALE
  return (
    <SiteShell locale={locale}>
      <ErrorPage />
    </SiteShell>
  )
}
