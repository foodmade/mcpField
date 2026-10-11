import { SITE } from '../lib/seo'

export function loader() {
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${SITE}/sitemap.xml`, ''].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
