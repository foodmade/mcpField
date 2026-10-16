export const SKILLS_SH_ORIGIN = 'https://skills.sh'
/** 官方 API（文档 https://skills.sh/docs/api）：需要 Vercel OIDC 令牌，认证后每分钟 600 次 */
export const SKILLS_SH_API = `${SKILLS_SH_ORIGIN}/api/v1`

/** all-time：全站排行榜（按累计安装量，只能翻到前 10 万条）；trending：近期增长最快的（约 1 万条，安装量是近期的） */
export type ListView = 'all-time' | 'trending'

/** 排行榜，每页最多 500 条 */
export function listUrl(page: number, view: ListView = 'all-time', perPage = 500): string {
  return `${SKILLS_SH_API}/skills?view=${view}&per_page=${perPage}&page=${page}`
}

/** 单个 skill 的详情：source 是 owner/repo（GitHub）或域名（well-known），slug 是 skill 名 */
export function skillUrl(source: string, slug: string): string {
  return `${SKILLS_SH_API}/skills/${source.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(slug)}`
}

/** 详情地址 → 安全审计地址 */
export function auditUrlFor(skillDetailUrl: string): string {
  return skillDetailUrl.replace(`${SKILLS_SH_API}/skills/`, `${SKILLS_SH_API}/skills/audit/`)
}
