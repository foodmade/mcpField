import { useId } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { useI18n } from '../i18n/context'

/**
 * 品牌标志：一只插头画成的字母 F（Field）——竖笔是插头本体，两道横笔是插脚，下方一根线缆。
 * 放在带 group 的元素里时，悬停会让插头向右“插进去”，插脚尖端闪一下火花。
 * 同一图形的静态文件：public/logo.svg（彩色）、public/favicon.svg（渐变底白色，浏览器标签页）。
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}b`} x1="10" y1="6" x2="34" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3DDC97" />
          <stop offset="1" stopColor="#2B7FFF" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="11" x2="0" y2="35" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4BE3A2" />
          <stop offset="1" stopColor="#2CC98A" />
        </linearGradient>
      </defs>
      <g className="transition-transform duration-300 ease-[cubic-bezier(0.34,1.5,0.64,1)] group-hover:translate-x-1">
        <path d="M21 50.5C21 57 14 56.5 10 60.5" stroke="#2B7FFF" strokeWidth="5" strokeLinecap="round" />
        <path d="M15.5 44H26.5L24.6 51.2Q24 53 22.2 53H19.8Q18 53 17.4 51.2Z" fill="#2B7FFF" />
        <rect x="29" y="12" width="26" height="8.5" rx="4.25" fill={`url(#${id}p)`} />
        <rect x="29" y="26.5" width="18" height="8.5" rx="4.25" fill={`url(#${id}p)`} />
        <rect x="35" y="13.4" width="16" height="2" rx="1" fill="#fff" fillOpacity="0.45" />
        <rect x="35" y="27.9" width="9" height="2" rx="1" fill="#fff" fillOpacity="0.45" />
        <rect x="10" y="6" width="22" height="40" rx="8" fill={`url(#${id}b)`} />
        <rect x="14" y="10" width="3.4" height="15" rx="1.7" fill="#fff" fillOpacity="0.42" />
      </g>
      <path
        d="M61 10.5L62.2 13.8L65.5 15L62.2 16.2L61 19.5L59.8 16.2L56.5 15L59.8 13.8Z"
        fill="#9FF0CB"
        className="origin-center scale-0 opacity-0 transition-[scale,opacity] delay-100 duration-300 [transform-box:fill-box] group-hover:scale-100 group-hover:opacity-100"
      />
    </svg>
  )
}

/** 字标 mcpField：mcp 中等字重、Field 加粗，强调“场” */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx('tracking-[-0.02em]', className)}>
      <span className="font-medium text-text2">mcp</span>
      <span className="font-bold">Field</span>
    </span>
  )
}

/** 站点标志：插头 F + 字标，链接到首页 */
export function Logo({ className }: { className?: string }) {
  const { to } = useI18n()
  return (
    <Link to={to('/')} aria-label="mcpField" className={clsx('group flex shrink-0 items-center gap-2', className)}>
      <BrandMark className="size-8 overflow-visible" />
      <Wordmark className="text-lg" />
    </Link>
  )
}
