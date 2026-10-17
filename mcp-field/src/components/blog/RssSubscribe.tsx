import { ArrowSquareOut, CaretDown, RssSimple } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useState } from 'react'
import { useI18n } from '../../i18n/context'
import { SITE } from '../../lib/seo'
import { CopyButton } from '../detail/CopyButton'

export const FEED_URL = `${SITE}/blog/rss.xml`

/** 常见的在线 RSS 阅读器：点一下就打开它的订阅页 */
const READERS = [
  { name: 'Feedly', href: (url: string) => `https://feedly.com/i/subscription/feed/${encodeURIComponent(url)}` },
  { name: 'Inoreader', href: (url: string) => `https://www.inoreader.com/?add_feed=${encodeURIComponent(url)}` },
]

/** 页面 <head> 里的 RSS 自动发现：阅读器和浏览器插件填网站地址就能找到订阅源 */
export function RssAlternate() {
  const { m } = useI18n()
  return <link rel="alternate" type="application/rss+xml" title={m.blog.rss.feedTitle} href={FEED_URL} />
}

/**
 * 订阅按钮：RSS 地址是给阅读器读的，浏览器直接打开只会显示 XML 原文，
 * 所以点按钮不跳转，而是展开订阅方式：复制地址、在常见阅读器里订阅、查看源文件
 */
export function RssSubscribe() {
  const { m } = useI18n()
  const t = m.blog.rss
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-accent-ink transition-[filter] hover:brightness-110"
      >
        <RssSimple size={15} weight="bold" />
        {t.button}
        <CaretDown size={12} weight="bold" className={clsx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-[11px] text-text3">{t.url}</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-text2" title={FEED_URL}>
                {FEED_URL}
              </code>
              <CopyButton text={FEED_URL} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {READERS.map((r) => (
              <a key={r.name} href={r.href(FEED_URL)} target="_blank" rel="noopener noreferrer" className="flex h-8 items-center justify-between rounded-md border border-line px-2.5 text-xs text-text2 transition-colors hover:border-fg/25 hover:text-ink">
                {t.openIn(r.name)}
                <ArrowSquareOut size={13} className="text-text3" />
              </a>
            ))}
          </div>
          <a href="/blog/rss.xml" target="_blank" rel="noopener" className="text-[11px] text-text3 underline decoration-fg/20 underline-offset-2 hover:text-ink">
            {t.source}
          </a>
        </div>
      )}
    </div>
  )
}
