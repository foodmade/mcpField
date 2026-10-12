import type { IdentityHints, RepositoryRef } from './draft.ts'

const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'])

/**
 * 平台域名：这些站点上的页面不是项目自己的官网，不能当身份。
 * 代码托管、包仓库会先尝试转成仓库 / 包的键；目录站、短链接直接忽略。
 */
const PLATFORM_HOSTS = new Set([
  ...REPO_HOSTS,
  'npmjs.com',
  'pypi.org',
  'hub.docker.com',
  'marketplace.visualstudio.com',
  'mcp.so',
  'smithery.ai',
  'glama.ai',
  'pulsemcp.com',
  'mcpmarket.com',
  'modelcontextprotocol.io',
  'deepwiki.com',
  'aka.ms',
  'bit.ly',
])

/**
 * 启动器 / 开发工具：出现在安装命令里，但不是服务本身的包
 * （npx mcp-remote <url>、npx @smithery/cli run …、npx tsx src/index.ts）。
 * 2026-10 mcp.so 实测：@smithery/cli 526 条、mcp-remote 249、nx 247、inspector 188。
 */
const LAUNCHER_PACKAGES = new Set([
  'npm:@smithery/cli',
  'npm:mcp-remote',
  'npm:nx',
  'npm:@modelcontextprotocol/inspector',
  'npm:tsx',
  'npm:ts-node',
  'npm:tsc',
  'npm:typescript',
  'npm:wrangler',
  'npm:skills',
  'npm:supergateway',
  'npm:playwright',
  'npm:fastmcp',
  'npm:node',
  'npm:npm',
  'npm:pnpm',
  'npm:yarn',
  'npm:bun',
  'npm:deno',
  'pypi:mcpo',
  'pypi:run',
  'pypi:ensurepath',
  'pypi:cookiecutter',
  'pypi:mcp',
  'pypi:fastmcp',
  'pypi:uv',
  'pypi:pip',
])

/** npm 包名规则（小写；不含版本） */
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
/** PyPI 项目名规则（PEP 508） */
const PYPI_NAME = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i
/** 文档里的占位写法：{host}、<your-domain>、${PORT}、YOUR_API_KEY */
const PLACEHOLDER = /[{}<>$]|your[-_]/i

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

function parseHttpUrl(input: string): URL | undefined {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

const bareHost = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '')
const hostPath = (url: URL) => bareHost(url) + url.pathname.replace(/\/+$/, '')

/** 本机、内网、示例域名、没有点号的主机名：文档里的示例地址，不是服务真实的端点 */
function isLocalHost(host: string): boolean {
  return (
    !host.includes('.') ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith('[') ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    /(^|\.)example\.(com|org|net)$/.test(host)
  )
}

/* ---------- 单个键 ---------- */

/**
 * 镜像组织：github.com/mcp-mirror/<owner>_<repo> 是 <owner>/<repo> 的镜像（2026-10 mcp.so 实测 461 条）。
 * GitHub 用户名不能含下划线，所以第一个下划线前就是原作者。
 */
const MIRROR_OWNERS = new Set(['mcp-mirror'])

export function repoKey(ref: RepositoryRef): string {
  let { owner, name } = ref
  const split = name.indexOf('_')
  if (ref.host === 'github.com' && MIRROR_OWNERS.has(owner) && split > 0 && split < name.length - 1) {
    owner = name.slice(0, split)
    name = name.slice(split + 1)
  }
  return `repo:${ref.host}/${owner}/${name}${ref.path ? '/' + ref.path.toLowerCase() : ''}`
}

/** @Scope/Pkg@1.2.3 → npm:@scope/pkg；不合规的包名或启动器返回 undefined */
export function npmKey(name: string | undefined): string | undefined {
  const value = name?.trim().toLowerCase().replace(/(.)@[^/]*$/, '$1')
  if (!value || !NPM_NAME.test(value)) return undefined
  const key = `npm:${value}`
  return LAUNCHER_PACKAGES.has(key) ? undefined : key
}

/** 按 PEP 503 归一化：Foo_Bar.baz → foo-bar-baz；去掉 pkg@latest、pkg==1.0 之类的版本 */
export function pypiKey(name: string | undefined): string | undefined {
  const value = name?.trim().split(/[@=<>~!;[\s]/)[0]
  if (!value || !PYPI_NAME.test(value)) return undefined
  const key = `pypi:${value.toLowerCase().replace(/[-_.]+/g, '-')}`
  return LAUNCHER_PACKAGES.has(key) ? undefined : key
}

export function remoteKey(input: string | undefined): string | undefined {
  if (!input || PLACEHOLDER.test(input)) return undefined
  const url = parseHttpUrl(input)
  if (!url || isLocalHost(bareHost(url))) return undefined
  return `remote:${hostPath(url)}`
}

/* ---------- 全部候选键 ---------- */

export type IdentityKeyType = 'skill' | 'repo' | 'registry' | 'npm' | 'pypi' | 'remote' | 'site'

export interface IdentityKey {
  type: IdentityKeyType
  key: string
  /** 强键相同即视为同一实体；弱键（官网、Skill 所在仓库）只提示可能重复，不自动合并 */
  strong: boolean
}

const typeOf = (key: string) => key.slice(0, key.indexOf(':')) as IdentityKeyType

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 官网是 npm / PyPI / 代码仓库页面时，转成对应的键；平台首页、目录站返回 null；其余为普通官网 */
function websiteKey(input: string): string | null | undefined {
  const url = parseHttpUrl(input)
  if (!url) return undefined
  const host = bareHost(url)
  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment)
  if (host === 'npmjs.com' && segments[0] === 'package') return npmKey(segments.slice(1, segments[1]?.startsWith('@') ? 3 : 2).join('/')) ?? null
  if (host === 'pypi.org' && segments[0] === 'project') return pypiKey(segments[1]) ?? null
  const repo = parseRepositoryUrl(input)
  if (repo) return repoKey(repo)
  if (PLATFORM_HOSTS.has(host) || isLocalHost(host)) return null
  return `site:${hostPath(url)}`
}

/**
 * 跨来源合并用的全部候选键，按可信度从高到低：
 * Skill 键 > 仓库（含子目录）> 官方 Registry 名称 > npm 包 > PyPI 包 > 远程地址 > 官网。
 * 同一仓库里通常有多个 Skill，所以有 Skill 键时仓库只算弱键。
 */
export function identityKeys(hints: IdentityHints): IdentityKey[] {
  const result: IdentityKey[] = []
  const add = (key: string | null | undefined, strong = true) => {
    if (key && !result.some((k) => k.key === key)) result.push({ type: typeOf(key), key, strong })
  }
  const isSkill = !!hints.skillKey?.trim()

  if (isSkill) add(`skill:${hints.skillKey!.trim().toLowerCase()}`)
  if (hints.repository) add(repoKey(hints.repository), !isSkill)
  if (hints.registryName?.trim()) add(`registry:${hints.registryName.trim().toLowerCase()}`)
  add(npmKey(hints.npmPackage))
  add(pypiKey(hints.pypiPackage))
  add(remoteKey(hints.remoteUrl))
  if (hints.website) {
    const key = websiteKey(hints.website)
    // 官网指向的仓库与仓库字段不一致时不当强键，避免把 fork、教程仓库合进来
    const strong = key?.startsWith('site:') ? false : key?.startsWith('repo:') ? !hints.repository && !isSkill : true
    add(key, strong)
  }
  return [...result.filter((k) => k.strong), ...result.filter((k) => !k.strong)]
}

/** 草稿的主键：候选键里可信度最高的一个 */
export function identityKey(hints: IdentityHints): string | null {
  return identityKeys(hints)[0]?.key ?? null
}
