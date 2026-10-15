import { LOCALE_META, LOCALES, type Locale } from '../i18n/locales'
import { fetchFacets, ROUTE, type Kind } from '../lib/api/entities'
import { fetchSitemapPage } from '../lib/api/sitemap'
import { CATEGORIES } from '../lib/categories'
import { absoluteUrl } from '../lib/seo'
import type { Route } from './+types/sitemap'

const KIND_BY_ROUTE = Object.fromEntries(Object.entries(ROUTE).map(([kind, route]) => [route, kind as Kind]))
/** 能直接放进 URL 路径的 slug；个别源站数据把网址当成了 slug，这类条目不进 sitemap */
const SAFE_SLUG = /^[A-Za-z0-9._~-]+$/

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const xmlResponse = (xml: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${xml}`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  })

/** 一条 URL：带全部语言版本的 hreflang 互链 */
function urlEntry(locale: Locale, path: string, query = '', lastmod?: string | null) {
  const alternates = LOCALES.map((l) => `<xhtml:link rel="alternate" hreflang="${LOCALE_META[l].htmlLang}" href="${escapeXml(absoluteUrl(l, path, query))}"/>`).join('')
  const xDefault = `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(absoluteUrl('zh', path, query))}"/>`
  const mod = lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''
  return `<url><loc>${escapeXml(absoluteUrl(locale, path, query))}</loc>${mod}${alternates}${xDefault}</url>`
}

const urlset = (entries: string[]) =>
  xmlResponse(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`)

/** 首页、各目录页、有条目的分类页、标签页和隐私政策（三种语言） */
async function pagesSitemap(signal: AbortSignal) {
  const paths: [string, string][] = [['/', ''], ['/remote-servers', ''], ['/tags', ''], ['/rankings', ''], ['/privacy', '']]
  const facets = await Promise.all((Object.keys(ROUTE) as Kind[]).map((kind) => fetchFacets(kind, {}, signal).then((f) => [kind, f] as const)))
  for (const [kind, f] of facets) {
    paths.push([`/${ROUTE[kind]}`, ''])
    const known = new Set(CATEGORIES[kind].map((c) => c.slug))
    for (const c of f.categories) if (c.slug && known.has(c.slug) && c.count > 0) paths.push([`/${ROUTE[kind]}`, `category=${c.slug}`])
  }
  return urlset(LOCALES.flatMap((l) => paths.map(([path, query]) => urlEntry(l, path, query))))
}

/** sitemaps/pages.xml，或 sitemaps/<类型>-<语言>-<页码>.xml */
export async function loader({ params, request }: Route.LoaderArgs) {
  if (params.file === 'pages.xml') return pagesSitemap(request.signal)
  const m = /^([a-z-]+)-(zh|en|ja)-(\d+)\.xml$/.exec(params.file)
  const kind = m ? KIND_BY_ROUTE[m[1]!] : undefined
  if (!m || !kind) throw new Response('Not Found', { status: 404 })
  const rows = await fetchSitemapPage(kind, Number(m[3]), request.signal)
  if (rows.length === 0) throw new Response('Not Found', { status: 404 })
  const locale = m[2] as Locale
  return urlset(rows.filter((r) => SAFE_SLUG.test(r.slug)).map((r) => urlEntry(locale, `/${ROUTE[kind]}/${r.slug}`, '', r.updatedAt)))
}
