import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { Link } from 'react-router'
import remarkGfm from 'remark-gfm'
import { useI18n } from '../../i18n/context'
import { headingId } from '../../lib/blog'
import { CopyButton } from '../detail/CopyButton'
import { rehypeGithubAlerts } from '../detail/githubAlerts'

/*
 * 博客正文渲染（作者在后台写的 Markdown，不允许内嵌 HTML）：
 * 标题带锚点（与 lib/blog tableOfContents 的目录对应），代码块带语言名、复制按钮和高亮，
 * 表格加外框，带 title 的图片显示图注，站内链接走前端路由。样式见 blog-md.css，后台预览共用。
 */

type HNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HNode[] }

const textOf = (node: HNode | undefined): string => (node?.type === 'text' ? (node.value ?? '') : (node?.children ?? []).map(textOf).join(''))

/** 只带常用语言，避免整个 highlight.js 进包；没登记的语言原样显示 */
const lowlight = createLowlight({ bash, css, diff, go, javascript, json, markdown, python, rust, sql, typescript, xml, yaml })
lowlight.registerAlias({ bash: ['sh', 'shell', 'zsh', 'console'], javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'], xml: ['html'], yaml: ['yml'], python: ['py'], markdown: ['md'] })

const langOf = (code: HNode | undefined) => ((code?.properties?.className as string[] | undefined) ?? []).find((c) => c.startsWith('language-'))?.slice(9)

/** rehype 插件：二到四级标题加 id，代码块高亮 */
function rehypeBlog() {
  return (tree: HNode) => {
    const seen = new Map<string, number>()
    const walk = (node: HNode) => {
      for (const child of node.children ?? []) {
        if (child.type !== 'element') continue
        if (child.tagName && /^h[1-4]$/.test(child.tagName)) child.properties = { ...child.properties, id: headingId(textOf(child), seen) }
        if (child.tagName === 'pre') {
          const code = child.children?.find((c) => c.tagName === 'code')
          const lang = langOf(code)
          if (code && lang && lowlight.registered(lang)) code.children = lowlight.highlight(lang, textOf(code)).children as HNode[]
          continue
        }
        walk(child)
      }
    }
    walk(tree)
  }
}

/** 站内地址：/servers/x 或 https://mcpfield.com/servers/x，返回不带域名的路径 */
const internalPath = (href: string) => {
  const m = /^(?:https?:\/\/(?:www\.)?mcpfield\.com)?(\/(?!\/)[^\s]*)$/.exec(href)
  return m ? m[1]!.replace(/^\/(en|ja)(?=\/|$)/, '') || '/' : null
}

export function BlogMarkdown({ source }: { source: string }) {
  const { m, to } = useI18n()
  const rehypePlugins = useMemo(() => [rehypeBlog, rehypeGithubAlerts(m.detail.alerts)], [m])
  const components = useMemo<Components>(
    () => ({
      h1: ({ node: _n, ...p }) => <h2 {...p} />,
      // 单独一行的图片不包在 <p> 里（图注要用 <figure>）
      p: ({ node, ...p }) => (node?.children.length === 1 && (node.children[0] as HNode).tagName === 'img' ? <>{p.children}</> : <p {...p} />),
      pre: ({ node, children }) => {
        const code = node?.children?.[0] as HNode | undefined
        return (
          <div className="md-code">
            <div className="md-code-head">
              <span>{langOf(code) ?? 'text'}</span>
              <CopyButton text={textOf(code).replace(/\n$/, '')} className="border-transparent bg-transparent font-sans font-normal" />
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
        const img = <img src={typeof src === 'string' ? src : undefined} alt={alt || title || ''} loading="lazy" decoding="async" />
        return title ? (
          <figure>
            {img}
            <figcaption>{title}</figcaption>
          </figure>
        ) : (
          img
        )
      },
      a: ({ node: _n, href = '', children, ...p }) => {
        const path = internalPath(href)
        if (path) return <Link to={to(path)}>{children}</Link>
        if (href.startsWith('#')) return <a href={href}>{children}</a>
        return (
          <a {...p} href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        )
      },
    }),
    [to],
  )
  return (
    <div className="blog-md">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {source}
      </Markdown>
    </div>
  )
}
