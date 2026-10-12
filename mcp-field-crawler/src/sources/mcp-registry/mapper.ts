import { DraftBuilder } from '../../core/draft-builder.ts'
import type { AuthorPlatform, EntityDraft, EnvVarDraft, PackageDraft, RemoteDraft, RepositoryRef, ServerDetailDraft, Transport } from '../../core/draft.ts'
import { parseRepositoryUrl } from '../../core/identity.ts'
import type { Mapper } from '../../core/source.ts'
import type { SourceRecord } from '../../core/types.ts'
import { SECRET_NAME } from '../../extract/mcp-config.ts'
import { OFFICIAL_META, PUBLISHER_META, type RegistryEntry, type RegistryServer } from './schema.ts'

/*
 * 官方 MCP Registry 源记录 → 服务草稿。
 * Registry 是发布者自己登记的结构化数据：名称、简介、仓库、安装包、远程端点、环境变量、图标都直接用。
 * 没有分类、星数、工具列表：分类交给分类器，星数来自 GitHub 补全，工具列表以后由实时探测提供。
 */

type Blank = string | null | undefined

const TRANSPORTS = new Set<string>(['stdio', 'streamable-http', 'sse'])
const PACKAGE_TYPES = new Set<string>(['npm', 'pypi', 'oci', 'nuget', 'mcpb', 'cargo', 'go'])
/** 与 mcp.so 的 runtime 取值一致（按语言）；oci、mcpb 看不出语言 */
const RUNTIME_BY_TYPE: Record<string, string> = { npm: 'node', pypi: 'python', nuget: 'c#', cargo: 'rust', go: 'go' }

const opt = (value: Blank): string | undefined => value?.trim() || undefined

function iso(value: Blank): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** io.github.acme/weather → acme-weather；ai.smithery/foo → ai-smithery-foo */
export function registrySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(io|com)\.github\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 命名空间是反写的域名（ai.smithery → smithery.ai）；io.github.<login> 是经 GitHub 登录验证的账号 */
export function publisherOf(name: string): { platform: AuthorPlatform; login: string; url: string } {
  const namespace = name.split('/')[0]!
  const github = /^(?:io|com)\.github\.([A-Za-z0-9-]+)$/.exec(namespace)
  if (github) return { platform: 'github', login: github[1]!, url: `https://github.com/${github[1]}` }
  const domain = namespace.toLowerCase().split('.').reverse().join('.')
  return { platform: 'website', login: domain, url: `https://${domain}` }
}

/** 名称最后一段的通用词：没有 title 时不能直接当名称（2026-10 实测 site 564 条、mcp 491、mcp-server 218） */
const GENERIC_NAMES = new Set(['mcp', 'server', 'mcp-server', 'mcp_server', 'site', 'api', 'remote'])

/** 显示名：title；没有时取名称最后一段；最后一段是通用词时用命名空间里的账号或域名主体（com.acme/mcp → acme） */
export function displayName(s: Pick<RegistryServer, 'name' | 'title'>): string {
  const title = opt(s.title)
  if (title) return title
  const [namespace, ...rest] = s.name.split('/')
  const last = rest.at(-1) || namespace!
  if (!GENERIC_NAMES.has(last.toLowerCase())) return last
  const github = /^(?:io|com)\.github\.([A-Za-z0-9-]+)$/.exec(namespace!)
  return github ? github[1]! : namespace!.split('.').at(-1)!
}

/** repository.url + subfolder；subfolder 对应 monorepo 子目录 */
function repositoryOf(repo: RegistryServer['repository']): RepositoryRef | undefined {
  const ref = parseRepositoryUrl(repo?.url)
  if (!ref) return undefined
  const subfolder = repo?.subfolder?.trim().replace(/^\.?\/+|\/+$/g, '') ?? ''
  return subfolder && !ref.path ? { ...ref, path: subfolder } : ref
}

/** 选一个图标：优先非深色主题的，再选尺寸最大的（SVG 的 any 视为最大） */
export function pickIcon(icons: RegistryServer['icons']): string | undefined {
  const size = (sizes: string[] | null | undefined) => Math.max(0, ...(sizes ?? []).map((s) => (s === 'any' ? 4096 : Number.parseInt(s, 10) || 0)))
  return [...(icons ?? [])].sort((a, b) => Number(a.theme === 'dark') - Number(b.theme === 'dark') || size(b.sizes) - size(a.sizes))[0]?.src
}

function packagesOf(s: RegistryServer): PackageDraft[] {
  return (s.packages ?? []).map((p) => {
    const type = p.registryType.toLowerCase()
    const transport = p.transport?.type
    return {
      registryType: (PACKAGE_TYPES.has(type) ? type : 'other') as PackageDraft['registryType'],
      identifier: p.identifier.trim(),
      ...(opt(p.version) ? { version: opt(p.version) } : {}),
      ...(opt(p.runtimeHint) ? { runtimeHint: opt(p.runtimeHint) } : {}),
      ...(transport && TRANSPORTS.has(transport) ? { transport: transport as Transport } : {}),
    }
  })
}

/** 只记录名字、说明、是否必填；非机密变量才保留默认值，机密的取值一律不保存 */
function envVarsOf(s: RegistryServer): EnvVarDraft[] {
  const result = new Map<string, EnvVarDraft>()
  for (const v of (s.packages ?? []).flatMap((p) => p.environmentVariables ?? [])) {
    const name = v.name.trim()
    if (!name || result.has(name)) continue
    const secret = v.isSecret === true || SECRET_NAME.test(name)
    const fallback = !secret && typeof v.default === 'string' ? opt(v.default) : undefined
    result.set(name, { name, ...(opt(v.description) ? { description: opt(v.description) } : {}), required: v.isRequired === true, secret, ...(fallback ? { defaultValue: fallback } : {}) })
  }
  return [...result.values()]
}

function remotesOf(s: RegistryServer): RemoteDraft[] {
  return (s.remotes ?? []).map((r) => {
    const headers = (r.headers ?? []).map((h) => h.name.toLowerCase())
    const authType = headers.includes('authorization') ? 'bearer' : headers.length > 0 ? 'header' : 'unknown'
    return { transport: r.type === 'sse' ? 'sse' : 'streamable-http', url: r.url.trim(), authType }
  })
}

/** 发布者在 _meta 里提供的标签和关键词（结构不固定，只取字符串数组） */
function publisherTags(s: RegistryServer): string[] {
  const meta = s._meta?.[PUBLISHER_META]
  if (!meta || typeof meta !== 'object') return []
  const fields = meta as Record<string, unknown>
  return ['tags', 'keywords'].flatMap((key) => (Array.isArray(fields[key]) ? fields[key].filter((v): v is string => typeof v === 'string') : [])).slice(0, 20)
}

function mapServer(record: SourceRecord<RegistryEntry>): EntityDraft | null {
  const { server: s, _meta } = record.data
  const official = _meta?.[OFFICIAL_META]
  // 列表只返回最新版本，实测没有 deleted；保险起见不为已删除的生成草稿
  if (official?.status === 'deleted') return null

  const packages = packagesOf(s)
  const remotes = remotesOf(s)
  const runtime = packages.map((p) => RUNTIME_BY_TYPE[p.registryType]).find(Boolean)
  const detail: ServerDetailDraft = {
    isRemote: remotes.length > 0,
    ...(runtime ? { runtime } : {}),
    ...(opt(s.version) ? { version: opt(s.version) } : {}),
    transports: [...new Set([...packages.flatMap((p) => (p.transport ? [p.transport] : [])), ...remotes.map((r) => r.transport)])],
    packages,
    envVars: envVarsOf(s),
    remotes,
    tools: [],
  }
  const b = new DraftBuilder({ kind: 'server', sourceId: record.sourceId, externalId: record.externalId, sourceUrl: record.url, slug: registrySlug(s.name), name: displayName(s) }, detail)

  b.identity({
    registryName: s.name,
    repository: repositoryOf(s.repository),
    npmPackage: packages.find((p) => p.registryType === 'npm')?.identifier,
    pypiPackage: packages.find((p) => p.registryType === 'pypi')?.identifier,
    remoteUrl: remotes.find((r) => !r.url.includes('{'))?.url,
    website: opt(s.websiteUrl),
  })
    .set('sourceCreatedAt', iso(official?.publishedAt))
    .set('sourceUpdatedAt', iso(official?.updatedAt))
    .text('tagline', 'en', s.description)
    .link('repository', s.repository?.url)
    .link('website', s.websiteUrl)
    .author({ ...publisherOf(s.name), role: 'publisher' })
    .tags(publisherTags(s))
    .media('icon', pickIcon(s.icons))
  for (const p of packages) {
    if (p.registryType === 'npm') b.link('npm', `https://www.npmjs.com/package/${p.identifier}`)
    if (p.registryType === 'pypi') b.link('pypi', `https://pypi.org/project/${p.identifier}/`)
  }
  return b.build()
}

export class RegistryServerMapper implements Mapper<RegistryEntry> {
  /** 2：没有 title 且名称最后一段是通用词（mcp、site……）时，用命名空间里的账号或域名主体作名称 */
  readonly version = 2

  map(record: SourceRecord<RegistryEntry>): EntityDraft | null {
    return mapServer(record)
  }
}
