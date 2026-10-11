import type { EntityKind } from '../../core/types.ts'

export const MCPSO_ORIGIN = 'https://mcp.so'
export const MCPSO_SITEMAP = `${MCPSO_ORIGIN}/sitemap.xml`

/** 实体类型 ↔ 路径前缀 ↔ 站点地图分区（三者同名） */
export const SECTION_BY_KIND: Record<EntityKind, string> = {
  server: 'servers',
  client: 'clients',
  cli: 'cli',
  skill: 'skills',
  loop: 'loops',
  agent: 'agents',
}

const KIND_BY_SECTION = new Map(Object.entries(SECTION_BY_KIND).map(([kind, section]) => [section, kind as EntityKind]))

/** 只识别英文版详情页 /servers/<slug>；/zh、/ja 是同一条数据的翻译，不重复抓 */
export function classifyMcpSoUrl(url: URL): { kind: EntityKind; externalId: string } | null {
  if (url.hostname !== 'mcp.so') return null
  const match = /^\/([a-z-]+)\/([^/]+)\/?$/.exec(url.pathname)
  if (!match) return null
  const kind = KIND_BY_SECTION.get(match[1]!)
  return kind ? { kind, externalId: decodeURIComponent(match[2]!) } : null
}

/** 只展开需要的分区：sitemap.xml?section=servers&page=3 → server */
export function shouldExpandMcpSoSitemap(url: URL, wanted: readonly EntityKind[]): boolean {
  const kind = KIND_BY_SECTION.get(url.searchParams.get('section') ?? '')
  return kind !== undefined && wanted.includes(kind)
}
