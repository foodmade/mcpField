import { LOCALES } from '../i18n/locales'
import { fetchSitemapSummary, SITEMAP_PAGE_SIZE } from '../lib/api/sitemap'
import { SITE } from '../lib/seo'
import { xmlResponse } from './sitemap'
import type { Route } from './+types/sitemap-index'

/** sitemap 索引：目录页一个文件，详情页按"类型 × 语言 × 分页"拆分 */
export async function loader({ request }: Route.LoaderArgs) {
  const summary = await fetchSitemapSummary(request.signal)
  const files = ['pages.xml']
  for (const { route, total } of summary) {
    for (const locale of LOCALES) {
      for (let n = 1; n <= Math.ceil(total / SITEMAP_PAGE_SIZE); n++) files.push(`${route}-${locale}-${n}.xml`)
    }
  }
  const body = files.map((f) => `<sitemap><loc>${SITE}/sitemaps/${f}</loc></sitemap>`).join('')
  return xmlResponse(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`)
}
