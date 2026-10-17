import { Check, Copy } from '@phosphor-icons/react'
import { memo, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rehypeGithubAlerts } from '../lib/githubAlerts'

/* 文章预览：结构和网站文章页（mcp-field/src/components/blog/BlogMarkdown.tsx）一致，样式共用 blog-md.css；预览不做代码高亮 */

const ALERTS = { note: '说明', tip: '提示', important: '重要', warning: '注意', caution: '警告' }
const rehypePlugins = [rehypeGithubAlerts(ALERTS)]

type HNode = { type: string; value?: string; children?: HNode[] }
const textOf = (node: HNode | undefined): string => (node?.type === 'text' ? (node.value ?? '') : (node?.children ?? []).map(textOf).join(''))

function CodeCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).catch(() => {})
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="flex h-7 items-center gap-1 rounded-md px-2 font-sans text-xs font-normal text-text3 hover:bg-white/5 hover:text-ink"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? '已复制' : '复制'}
    </button>
  )
}

const components: Components = {
  h1: ({ node: _n, ...p }) => <h2 {...p} />,
  // 单独一行的图片不包在 <p> 里（图注要用 <figure>）
  p: ({ node, ...p }) => (node?.children.length === 1 && (node.children[0] as { tagName?: string }).tagName === 'img' ? <>{p.children}</> : <p {...p} />),
  pre: ({ node, children }) => {
    const code = (node?.children?.[0] ?? undefined) as (HNode & { properties?: { className?: string[] } }) | undefined
    const lang = code?.properties?.className?.find((c) => c.startsWith('language-'))?.slice(9) ?? 'text'
    return (
      <div className="md-code">
        <div className="md-code-head">
          <span>{lang}</span>
          <CodeCopy text={textOf(code).replace(/\n$/, '')} />
        </div>
        <pre>{children}</pre>
      </div>
    )
  },
  table: ({ node: _n, ...p }) => (
    <div className="md-table">
      <table {...p} />
    </div>
  ),
  img: ({ node: _n, src, alt, title }) => {
    const img = <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" />
    return title ? (
      <figure>
        {img}
        <figcaption>{title}</figcaption>
      </figure>
    ) : (
      img
    )
  },
  a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
}

export const MarkdownPreview = memo(function MarkdownPreview({ source, empty }: { source: string; empty?: ReactNode }) {
  if (!source.trim()) return <div className="py-20 text-center text-sm text-text3">{empty ?? '正文是空的'}</div>
  return (
    <div className="blog-md">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {source}
      </Markdown>
    </div>
  )
})
