import { CaretDown, GithubLogo, Sparkle, WarningCircle } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import type React from 'react'
import { useMemo, useState } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { ApiReadmeTranslation } from '../../lib/api/entities'
import { rehypeGithubAlerts } from './githubAlerts'

/**
 * README 里的相对路径（./docs/a.png、assets/logo.svg）指向仓库内文件：
 * 图片转成 raw 地址，链接转成仓库页面地址；HEAD 会跳到默认分支。
 */
function resolveUrl(url: string, key: string, repository: string | null): string {
  const safe = defaultUrlTransform(url)
  if (!safe || !repository || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(safe)) return safe
  const base = `${repository.replace(/\/+$/, '')}/${key === 'src' ? 'raw' : 'blob'}/HEAD/`
  try {
    return new URL(safe.replace(/^\.\//, '').replace(/^\//, ''), base).toString()
  } catch {
    return safe
  }
}

type HeadingTag = 'h3' | 'h4' | 'h5' | 'h6'

/** README 的标题整体下移两级（h1 → h3），挂在"详细介绍"（h2）之下，避免页面出现多个 h1；视觉大小由 md-hN 类保持 */
const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
  const Tag = `h${Math.min(level + 2, 6)}` as HeadingTag
  return ({ node: _node, ...props }: React.ComponentProps<'h1'> & { node?: unknown }) => <Tag {...props} className={`md-h${level}`} />
}

const components: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow ugc" />,
  img: ({ node: _node, ...props }) => <img {...props} loading="lazy" decoding="async" referrerPolicy="no-referrer" />,
}

/** 中英文切换的分段按钮 */
function Toggle({ value, onChange }: { value: 'translated' | 'original'; onChange: (v: 'translated' | 'original') => void }) {
  const { m } = useI18n()
  return (
    <div className="flex gap-0.5 rounded-[9px] bg-subtle p-[3px]" role="tablist">
      {(['translated', 'original'] as const).map((k) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={clsx('relative h-7 rounded-[7px] px-3 text-xs', value === k ? 'font-medium text-ink' : 'text-text3 hover:text-ink')}>
          {value === k && <motion.span layoutId="readme-tab" className="absolute inset-0 rounded-[7px] bg-white/10" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          <span className="relative">{m.detail.readmeTabs[k]}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 渲染第三方 README：GFM（表格、任务列表）+ 内嵌 HTML + GitHub 提示块，
 * HTML 先经过 rehype-sanitize 白名单过滤（去掉 script、事件属性、iframe 等）。
 * 有 AI 译文时默认显示译文并可切换原文；中日文页面没有译文时标明"英文原文"并默认折叠。
 */
export function MarkdownReadme({ content, repository, translation }: { content: string; repository: string | null; translation?: ApiReadmeTranslation | null }) {
  const { m, locale } = useI18n()
  const [view, setView] = useState<'translated' | 'original'>('translated')
  const showTranslated = !!translation && view === 'translated'
  // 本来就用中文或日文写的 README 不算"英文原文"
  const cjkReadme = useMemo(() => (content.match(/[぀-ヿ一-鿿]/g)?.length ?? 0) >= 200, [content])
  const englishOnly = !translation && locale !== 'en' && !cjkReadme
  const [expanded, setExpanded] = useState(!englishOnly)
  const t = m.detail.readmeAi
  const rehypePlugins = useMemo(() => [rehypeRaw, rehypeSanitize, rehypeGithubAlerts(m.detail.alerts)], [m])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          {englishOnly ? m.detail.readmeOriginal : m.detail.readme}
          {(englishOnly || (translation && view === 'original')) && <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] font-medium text-text3">{m.detail.englishBadge}</span>}
        </h2>
        {translation ? (
          <Toggle value={view} onChange={setView} />
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-text3"><GithubLogo size={13} />{m.client.readmeSrc}</span>
        )}
      </div>

      {showTranslated && (
        <div className="mb-5 flex flex-col gap-1.5 text-xs leading-relaxed text-text3">
          <p className="flex items-start gap-1.5"><Sparkle size={12} className="mt-0.5 shrink-0" />{t.note}</p>
          {translation.outdated && <p className="flex items-start gap-1.5 text-[#F2C94C]"><WarningCircle size={12} className="mt-0.5 shrink-0" />{t.outdated}</p>}
        </div>
      )}
      {englishOnly && t.englishHint && <p className="mb-5 text-xs leading-relaxed text-text3">{t.englishHint}</p>}

      <div className={clsx('relative', !expanded && 'max-h-[520px] overflow-hidden')}>
        <div className="md">
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} urlTransform={(url, key) => resolveUrl(url, key, repository)} components={components}>
            {showTranslated ? translation.content : content}
          </Markdown>
        </div>
        {!expanded && (
          <div className="absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-t from-bg via-bg/90 to-transparent pb-2">
            <button onClick={() => setExpanded(true)} className="flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-surface px-4 text-sm text-text2 hover:border-white/30 hover:text-ink">
              {t.expand}<CaretDown size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
