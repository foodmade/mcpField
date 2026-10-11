import type { BaseItem } from './api/entities'

/* 接口条目在界面上的通用展示规则 */

/** https://www.example.com/x → example.com */
export function host(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** github.com/owner/repo → github.com/owner */
function repoOwner(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const owner = u.pathname.split('/').filter(Boolean)[0]
    return owner ? `${u.hostname.replace(/^www\./, '')}/${owner}` : null
  } catch {
    return null
  }
}

/** github.com/owner/repo → owner/repo */
export function repoPath(url: string | null): string | null {
  if (!url) return null
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null
  } catch {
    return null
  }
}

/** 卡片副标题：官网域名，没有时用代码仓库的账号 */
export const domainOf = (i: BaseItem) => host(i.links.website) ?? repoOwner(i.links.repository)

/** 作者显示名 */
export const developerOf = (i: BaseItem) => i.author?.name ?? i.author?.login ?? null

/** 距今多少天（用于"N 天前更新"） */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}
