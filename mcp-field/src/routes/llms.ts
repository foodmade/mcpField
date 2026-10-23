import { en } from '../i18n/en'
import { fetchBlogAll } from '../lib/api/blog'
import { fetchStats } from '../lib/api/home'
import { absoluteUrl, SITE } from '../lib/seo'

/*
 * llms.txt（https://llmstxt.org）：给 AI 助手和 agent 看的站点说明，Markdown 格式。
 * 用英文写、链接指向英文页面（AI 读英文最稳），末尾列出中文、日文版本的地址规则。
 * 各栏目的说明复用英文界面文案，条目数取全站统计，和页面上显示的一致。
 */

const link = (title: string, path: string, desc: string) => `- [${title}](${absoluteUrl('en', path)}): ${desc}`
const count = (n: number) => n.toLocaleString('en-US')

export async function loader({ request }: { request: Request }) {
  const [stats, posts] = await Promise.all([fetchStats(request.signal), fetchBlogAll(request.signal, 'en')])
  const { totals } = stats
  const lines = [
    '# MCP Field',
    '',
    `> ${en.meta.homeDescription}`,
    '',
    'Every entry has its own detail page with an overview, source repository, install or config commands and, for MCP servers, the list of tools it exposes. Detail pages live at `/en/{directory}/{slug}`, e.g. `/en/servers/{slug}`. Listings are crawled from public registries and refreshed daily.',
    '',
    '## Directories',
    '',
    link(en.dir.title, '/servers', `${count(totals.server)}${en.dir.subAfter}`),
    link(en.dirs.remote.title, '/remote-servers', `${count(stats.remote)}${en.dirs.remote.subAfter}`),
    link(en.dirs.clients.title, '/clients', `${count(totals.client)}${en.dirs.clients.subAfter}`),
    link(en.dirs.cli.title, '/cli', `${count(totals.cli)}${en.dirs.cli.subAfter}`),
    link(en.dirs.skills.title, '/skills', `${count(totals.skill)}${en.dirs.skills.subAfter}`),
    link(en.dirs.loops.title, '/loops', `${count(totals.loop)}${en.dirs.loops.subAfter}`),
    link(en.dirs.agents.title, '/agents', `${count(totals.agent)}${en.dirs.agents.subAfter}`),
    '',
    '## Rankings and tags',
    '',
    link(en.rankings.title, '/rankings', en.rankings.sub),
    link(en.tags.title, '/tags', en.tags.sub),
    '',
    '## Blog',
    '',
    link('Blog', '/blog', en.blog.seoDesc),
    // 还没有英文译文的文章，标题和链接都用中文版
    ...posts.slice(0, 30).map((p) => `- [${p.title}](${absoluteUrl(p.locale, `/blog/${p.slug}`)})${p.summary ? `: ${p.summary.replace(/\s+/g, ' ').trim()}` : ''}`),
    '',
    '## Optional',
    '',
    `- [Chinese version](${SITE}/): the default language; same paths without a prefix, e.g. \`/servers/{slug}\``,
    `- [Japanese version](${SITE}/ja): same paths under \`/ja\`, e.g. \`/ja/servers/{slug}\``,
    `- [Sitemap](${SITE}/sitemap.xml): every directory and detail page in all three languages`,
    `- [Blog RSS](${SITE}/blog/rss.xml): latest blog posts`,
    '',
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
