import { useI18n } from '../i18n/context'
import { LOCALE_META, LOCALES, type Locale } from '../i18n/locales'
import { absoluteUrl, clip, OG_LOCALE, SITE } from '../lib/seo'

type Props = {
  title: string
  description?: string | null
  /** 不带语言前缀的路径，如 /servers/github */
  path: string
  /** canonical 保留的查询参数（已排序、已过滤） */
  query?: string
  image?: string | null
  /** 搜索结果页等不希望被收录的页面 */
  noindex?: boolean
  type?: 'website' | 'article'
  /** JSON-LD 结构化数据 */
  jsonLd?: object
  /** 有内容的语言版本（hreflang 只列这些）；不传时三种语言都有 */
  locales?: readonly Locale[]
}

/**
 * 页面级 SEO 标签。React 19 会把 title / meta / link 提升到 <head>，
 * 服务端渲染时直接出现在 HTML 里，站内跳转时随页面卸载自动移除。
 */
export function Seo({ title, description, path, query = '', image, noindex, type = 'website', jsonLd, locales = LOCALES }: Props) {
  const { locale } = useI18n()
  const url = absoluteUrl(locale, path, query)
  const desc = clip(description)
  // 详情页用条目图标（小图卡片）；首页、目录页等没有图标的用品牌分享图（大图卡片，scripts/og-image 生成）
  const ogImage = image ?? `${SITE}/og/${locale}.png`
  return (
    <>
      <title>{title}</title>
      {desc && <meta name="description" content={desc} />}
      {/* 不收录的页面（搜索结果、错误页）不声明 canonical 和语言版本，避免信号冲突 */}
      {noindex ? (
        <meta name="robots" content="noindex, follow" />
      ) : (
        <>
          <link rel="canonical" href={url} />
          {locales.map((l) => <link key={l} rel="alternate" hrefLang={LOCALE_META[l].htmlLang} href={absoluteUrl(l, path, query)} />)}
          <link rel="alternate" hrefLang="x-default" href={absoluteUrl('zh', path, query)} />
        </>
      )}
      <meta property="og:site_name" content="MCP Field" />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {desc && <meta property="og:description" content={desc} />}
      <meta property="og:url" content={url} />
      <meta property="og:locale" content={OG_LOCALE[locale]} />
      {locales.filter((l) => l !== locale).map((l) => <meta key={l} property="og:locale:alternate" content={OG_LOCALE[l]} />)}
      <meta property="og:image" content={ogImage} />
      {!image && (
        <>
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content="MCP Field" />
        </>
      )}
      <meta name="twitter:card" content={image ? 'summary' : 'summary_large_image'} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />}
    </>
  )
}
