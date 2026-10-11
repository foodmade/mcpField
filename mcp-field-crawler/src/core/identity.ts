import type { IdentityHints, RepositoryRef } from './draft.ts'

const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'])

/**
 * 把各种写法的仓库地址统一成 { host, owner, name, path }。
 * monorepo 里的子目录（/tree/main/src/filesystem）保留为 path，
 * 否则 modelcontextprotocol/servers 下的十几个服务会被合并成一个。
 */
export function parseRepositoryUrl(input: string | null | undefined): RepositoryRef | undefined {
  if (!input) return undefined
  let url: URL
  try {
    url = new URL(input.trim().replace(/^git\+/, '').replace(/^git@([^:]+):/, 'https://$1/'))
  } catch {
    return undefined
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!REPO_HOSTS.has(host)) return undefined

  const segments = url.pathname.split('/').filter(Boolean)
  const [owner, rawName, marker, , ...rest] = segments
  if (!owner || !rawName) return undefined
  const name = rawName.replace(/\.git$/i, '')
  const path = marker === 'tree' || marker === 'blob' ? rest.join('/').replace(/\/+$/, '') : ''
  return { host, owner: owner.toLowerCase(), name: name.toLowerCase(), path }
}

export function repositoryUrl(ref: RepositoryRef): string {
  return `https://${ref.host}/${ref.owner}/${ref.name}`
}

function normalizeHostPath(input: string): string | undefined {
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    return host + path
  } catch {
    return undefined
  }
}

/**
 * 跨来源合并实体用的唯一键，按可信度从高到低选取：
 * Skill 键 > 仓库（含子目录）> 官方 Registry 名称 > npm 包 > PyPI 包 > 远程地址 > 官网。
 */
export function identityKey(hints: IdentityHints): string | null {
  if (hints.skillKey) return `skill:${hints.skillKey.toLowerCase()}`
  const repo = hints.repository
  if (repo) return `repo:${repo.host}/${repo.owner}/${repo.name}${repo.path ? '/' + repo.path.toLowerCase() : ''}`
  if (hints.registryName) return `registry:${hints.registryName.toLowerCase()}`
  if (hints.npmPackage) return `npm:${hints.npmPackage.toLowerCase()}`
  if (hints.pypiPackage) return `pypi:${hints.pypiPackage.toLowerCase().replace(/[-_.]+/g, '-')}`
  const remote = hints.remoteUrl && normalizeHostPath(hints.remoteUrl)
  if (remote) return `remote:${remote}`
  const site = hints.website && normalizeHostPath(hints.website)
  if (site) return `site:${site}`
  return null
}
