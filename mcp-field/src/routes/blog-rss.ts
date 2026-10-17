import { fetchBlogAll } from '../lib/api/blog'
import { absoluteUrl, SITE } from '../lib/seo'

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 博客的 RSS 2.0 订阅源：最近 30 篇，正文只给摘要（全文在网站上看） */
export async function loader({ request }: { request: Request }) {
  const posts = (await fetchBlogAll(request.signal)).slice(0, 30)
  const items = posts
    .map((p) => {
      const url = absoluteUrl('zh', `/blog/${p.slug}`)
      return [
        '<item>',
        `<title>${escapeXml(p.title)}</title>`,
        `<link>${url}</link>`,
        `<guid isPermaLink="true">${url}</guid>`,
        `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        `<dc:creator>${escapeXml(p.authorName)}</dc:creator>`,
        ...p.tags.map((t) => `<category>${escapeXml(t)}</category>`),
        p.summary ? `<description>${escapeXml(p.summary)}</description>` : '',
        '</item>',
      ].join('')
    })
    .join('')
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<channel>',
    '<title>MCP Field 博客</title>',
    `<link>${absoluteUrl('zh', '/blog')}</link>`,
    `<atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml"/>`,
    '<description>MCP 生态观察、上手教程、实测记录与 MCP Field 的产品更新。</description>',
    '<language>zh-CN</language>',
    posts[0] ? `<lastBuildDate>${new Date(posts[0].publishedAt).toUTCString()}</lastBuildDate>` : '',
    items,
    '</channel>',
    '</rss>',
  ].join('')
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } })
}
