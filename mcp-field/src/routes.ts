import { index, route, type RouteConfig } from '@react-router/dev/routes'

/*
 * 中文没有前缀，英文、日文用 /en、/ja 前缀：所有页面挂在可选的 :lang 段下，
 * 由 routes/site.tsx 校验语言（未知前缀返回 404）。
 */
export default [
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap-index.ts'),
  route('sitemaps/:file', 'routes/sitemap.ts'),
  route(':lang?', 'routes/site.tsx', [
    index('pages/Home.tsx'),
    route('servers', 'pages/Servers.tsx'),
    route('servers/:slug', 'pages/ServerDetail.tsx'),
    route('remote-servers', 'pages/RemoteServers.tsx'),
    route('clients', 'pages/Clients.tsx'),
    route('clients/:slug', 'pages/ClientDetail.tsx'),
    route('cli', 'pages/Clis.tsx'),
    route('cli/:slug', 'pages/CliDetail.tsx'),
    route('skills', 'pages/Skills.tsx'),
    route('skills/:slug', 'pages/SkillDetail.tsx'),
    route('loops', 'pages/Loops.tsx'),
    route('loops/:slug', 'pages/LoopDetail.tsx'),
    route('agents', 'pages/Agents.tsx'),
    route('agents/:slug', 'pages/AgentDetail.tsx'),
    route('*', 'routes/not-found.tsx'),
  ]),
] satisfies RouteConfig
