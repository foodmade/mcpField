import { SITE } from '../lib/seo'

/*
 * 列表页的筛选组合不让爬虫抓：标签筛选、搜索结果本来就 noindex，排序页的 canonical 去掉了排序，和不排序的页面重复；
 * 分类、分页（及两者组合）保留，详情页靠 sitemap 和分页发现。博客的标签页可以收录，单独放开（博客的查询串总是 tag 在最前）。
 * Google 按最长匹配取规则，Allow 比 Disallow 长才生效。
 * GoogleOther 是 Google 内部研发用的通用爬虫，不参与搜索收录，又和 Googlebot 共用对本站的抓取额度，整站禁止。
 * Content-Signal（https://contentsignals.org）声明内容用途：允许搜索收录、AI 回答时引用、AI 训练。
 */
const RULES = [
  'User-agent: *',
  'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
  'Allow: /',
  'Disallow: /api/',
  'Disallow: /*?tag=',
  'Disallow: /*&tag=',
  'Disallow: /*?q=',
  'Disallow: /*&q=',
  'Disallow: /*?sort=',
  'Disallow: /*&sort=',
  'Allow: /blog?tag=',
  'Allow: /*/blog?tag=',
  '',
  'User-agent: GoogleOther',
  'Disallow: /',
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  '',
]

export function loader() {
  return new Response(RULES.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
