import { motion } from 'motion/react'
import { ArrowClockwise, ArrowLeft, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { isRouteErrorResponse, Link, useLocation, useRevalidator, useRouteError } from 'react-router'
import { useI18n } from '../i18n/context'
import { stripLocale } from '../i18n/locales'
import { Seo } from './Seo'

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-[60vh] max-w-[1248px] flex-col items-center justify-center gap-3 px-6 text-center">{children}</div>
}

type NotFoundText = { title: string; hint: string; back: string }

/**
 * 路由错误页：404 显示"不存在"（文案和返回地址可由详情页传入），其余错误显示加载失败和重试。
 * 状态码由 loader 抛出的 data(null, { status }) 决定，服务端会原样返回。
 */
export function ErrorPage({ notFound, backHref = '/' }: { notFound?: NotFoundText; backHref?: string }) {
  const { m, to } = useI18n()
  const path = stripLocale(useLocation().pathname).rest
  const error = useRouteError()
  const revalidator = useRevalidator()
  if (isRouteErrorResponse(error) && error.status === 404) {
    const t = notFound ?? m.notFound
    return (
      <Centered>
        <Seo title={`${t.title} · MCP Field`} path={path} noindex />
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity }} className="grid size-16 place-items-center rounded-[18px] border border-fg/10 bg-fg/[0.04] text-text2"><MagnifyingGlass size={28} /></motion.div>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-text2">{t.hint}</p>
        <Link to={to(backHref)} className="mt-2 flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink"><ArrowLeft size={14} />{t.back}</Link>
      </Centered>
    )
  }
  return (
    <Centered>
      <Seo title={`${m.dir.loadError} · MCP Field`} path={path} noindex />
      <WarningCircle size={30} className="text-[#F2994A]" />
      <h1 className="text-xl font-semibold">{m.dir.loadError}</h1>
      <p className="max-w-[420px] text-sm text-text2">{m.dir.loadErrorHint}</p>
      <button onClick={() => void revalidator.revalidate()} className="mt-2 flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink"><ArrowClockwise size={14} />{m.dir.retry}</button>
    </Centered>
  )
}
