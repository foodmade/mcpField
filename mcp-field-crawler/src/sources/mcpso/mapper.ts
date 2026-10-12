import { DraftBuilder } from '../../core/draft-builder.ts'
import type { DetailByKind, EntityDraft, IssueCode, SkillAuditDraft, Transport } from '../../core/draft.ts'
import { parseRepositoryUrl, repositoryUrl } from '../../core/identity.ts'
import type { Mapper } from '../../core/source.ts'
import type { EntityKind, SourceRecord } from '../../core/types.ts'
import { parseMcpServersConfig } from '../../extract/mcp-config.ts'
import { toToolDrafts } from '../../extract/mcp-tools.ts'
import { mapCategory } from './categories.ts'
import type { McpSoData } from './schema.ts'
import { MCPSO_ORIGIN } from './urls.ts'

/*
 * mcp.so 源记录 → 细粒度草稿。
 * 只映射"事实"：名称、链接、作者、分类、标签、指标、运行方式、工具定义，以及上游项目自己的简介和 README（README 现在只用 GitHub 抓取的，见 readme/source.ts）。
 * mcp.so 自己撰写的内容（CLI 描述与能力列表、Skill 摘要、Agent 简介、Loop 的提示词与步骤）不映射，
 * 这些由我们自己生成，见 docs/DESIGN.md。
 */

type Rec<K extends EntityKind> = SourceRecord<McpSoData<K>>
type Blank = string | null | undefined

interface IssueSink {
  issue(code: IssueCode, detail?: string): unknown
}

const TRANSPORTS = new Set<string>(['stdio', 'streamable-http', 'sse'])
const NAME_STOPWORDS = new Set(['mcp', 'server', 'the', 'and', 'for', 'api'])

const opt = (value: Blank): string | undefined => value?.trim() || undefined

function iso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** 'Jan 19, 2026' / '2026-07-10' → '2026-01-19' */
function day(value: Blank): string | undefined {
  if (!value?.trim()) return undefined
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : new Date(value + ' UTC')
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

function jsonField<T>(sink: IssueSink, field: string, value: Blank, fallback: T): T {
  if (!value?.trim()) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    sink.issue('invalid_json_field', field)
    return fallback
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function githubLogin(url: Blank): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') === 'github.com' ? u.pathname.split('/').filter(Boolean)[0] : undefined
  } catch {
    return undefined
  }
}

function githubAvatar(url: Blank): string | undefined {
  return url && url.startsWith('https://avatars.githubusercontent.com/') ? url : undefined
}

/**
 * 按 GitHub 用户名拼头像地址（mcp.so 的 CLI 没有图标字段，站点上显示的就是所有者头像）。
 * 用 github.com/<login>.png：它会跳转到 /u/<id> 的真实头像；avatars.githubusercontent.com/<login> 对不少组织账号只返回默认图。
 */
function githubOwnerAvatar(login: Blank): string | undefined {
  const value = login?.trim()
  return value && /^[A-Za-z0-9-]+$/.test(value) ? `https://github.com/${value}.png` : undefined
}

/** 名称与 slug 没有任何共同词、或出现"Slack Slack"这样的重复词，多半是源站数据错误 */
function looksSuspicious(name: string, slug: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (words.some((w, i) => i > 0 && w === words[i - 1])) return true
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t)))
  const a = tokens(name)
  const b = tokens(slug)
  if (a.size === 0 || b.size === 0) return false
  return ![...a].some((t) => b.has(t) || [...b].some((s) => s.includes(t) || t.includes(s)))
}

function start<K extends EntityKind>(kind: K, record: SourceRecord<McpSoData>, item: { slug: string; name: string }, detail: DetailByKind[K]) {
  const builder = new DraftBuilder(
    { kind, sourceId: record.sourceId, externalId: record.externalId, sourceUrl: record.url, slug: item.slug, name: item.name.trim() },
    detail,
  )
  if (looksSuspicious(item.name, item.slug)) builder.issue('suspicious_name', item.name)
  return builder
}

function installFromCommand(command: string) {
  const manager = command.trim().split(/\s+/)[0]!.toLowerCase()
  const platform =
    manager === 'brew' ? 'macos' : ['winget', 'scoop', 'choco'].includes(manager) ? 'windows' : ['apt', 'apt-get', 'yum', 'dnf', 'pacman', 'snap'].includes(manager) ? 'linux' : 'any'
  return { manager, platform, command: command.trim() } as const
}

function parseAudit(value: string): SkillAuditDraft {
  const [auditor, verdict = ''] = value.split(/:\s*/, 2)
  const v = verdict.toLowerCase()
  const result = v.startsWith('pass') ? 'pass' : v.startsWith('fail') ? 'fail' : v.startsWith('warn') ? 'warn' : 'unknown'
  return { auditor: auditor!.trim(), result }
}

function mapServer(record: Rec<'server'>) {
  const { item, context } = record.data
  const b = start('server', record, item, { isRemote: !!item.isRemote, transports: [], packages: [], envVars: [], remotes: [], tools: [] })
  const config = parseMcpServersConfig(jsonField(b, 'config', item.config, null))
  if (config.proxied) b.issue('proxied_install_config', 'mcprouter')
  const npm = config.packages.find((p) => p.registryType === 'npm')
  const pypi = config.packages.find((p) => p.registryType === 'pypi')

  b.identity({
    repository: parseRepositoryUrl(item.repoUrl),
    npmPackage: npm?.identifier,
    pypiPackage: pypi?.identifier,
    remoteUrl: config.remotes[0]?.url,
    website: opt(item.websiteUrl),
  })
    .flags({ verified: !!item.verified, featured: !!item.featured })
    .set('license', item.license)
    .set('sourceCreatedAt', iso(item.createdAt))
    .set('sourceUpdatedAt', iso(item.updatedAt))
    .set('lastCommitAt', iso(item.lastCommitAt))
    .text('tagline', 'en', item.tagline)
    .text('readme', 'en', item.description, 'markdown')
    .link('repository', item.repoUrl)
    .link('website', item.websiteUrl)
    .link('docs', item.docsUrl)
    .author({
      platform: githubLogin(item.authorUrl) ? 'github' : 'other',
      login: githubLogin(item.authorUrl) ?? item.authorName,
      displayName: opt(item.authorName),
      url: opt(item.authorUrl),
      avatarUrl: githubAvatar(item.iconUrl),
      role: 'owner',
    })
    .category(mapCategory('server', context.categoryName), context.categoryName)
    .tags([...strings(jsonField(b, 'tags', item.tags, [])), ...(context.linkableTags ?? [])])
    .metric('github_stars', item.stars)
    .metric('source_views', item.viewCount)
    .media('icon', item.iconUrl, MCPSO_ORIGIN)
    .alias('previous_slug', item.previousSlug)
  for (const url of strings(jsonField(b, 'screenshots', item.screenshots, []))) b.media('screenshot', url, MCPSO_ORIGIN)

  b.detail((d) => {
    d.runtime = opt(item.runtime)
    d.authType = opt(item.authType)
    d.version = opt(item.version)
    d.transports = strings(jsonField(b, 'transports', item.transports, [])).filter((t): t is Transport => TRANSPORTS.has(t))
    d.tools = toToolDrafts(jsonField(b, 'tools', item.tools, []))
    if (!config.proxied) {
      d.packages = config.packages
      d.envVars = config.envVars
      d.remotes = config.remotes
    }
    // 源站的 isRemote 标记很少，配置里给了远程地址的也算远程服务
    d.isRemote = d.isRemote || d.remotes.length > 0
  })
  return b.build()
}

function mapClient(record: Rec<'client'>) {
  const { item } = record.data
  const b = start('client', record, item, { clientType: opt(item.category), runtime: opt(item.runtime) })
  b.identity({ repository: parseRepositoryUrl(item.repoUrl), website: opt(item.websiteUrl) })
    .flags({ verified: !!item.verified, featured: !!item.featured })
    .set('license', item.license)
    .set('sourceCreatedAt', iso(item.createdAt))
    .set('sourceUpdatedAt', iso(item.updatedAt))
    .set('lastCommitAt', iso(item.lastCommitAt))
    .text('tagline', 'en', item.tagline)
    .text('readme', 'en', item.description, 'markdown')
    .link('repository', item.repoUrl)
    .link('website', item.websiteUrl)
    .link('docs', item.docsUrl)
    .author({
      platform: githubLogin(item.authorUrl) ? 'github' : 'other',
      login: githubLogin(item.authorUrl) ?? item.authorName,
      displayName: opt(item.authorName),
      url: opt(item.authorUrl),
      avatarUrl: githubAvatar(item.iconUrl),
      role: 'owner',
    })
    .category(mapCategory('client', item.category), item.category)
    .tags(strings(jsonField(b, 'tags', item.tags, [])))
    .metric('github_stars', item.stars)
    .metric('source_views', item.viewCount)
    .media('icon', item.iconUrl, MCPSO_ORIGIN)
    .alias('previous_slug', item.previousSlug)
  for (const url of strings(jsonField(b, 'screenshots', item.screenshots, []))) b.media('screenshot', url, MCPSO_ORIGIN)
  return b.build()
}

function mapCli(record: Rec<'cli'>) {
  const { item } = record.data
  const sourceRepo = item.sources?.map((s) => parseRepositoryUrl(s.url)).find(Boolean)
  const repository = sourceRepo ?? (item.repository ? parseRepositoryUrl(`https://github.com/${item.repository}`) : undefined)
  const b = start('cli', record, item, {
    command: opt(item.command),
    cliType: opt(item.kind),
    agentReady: item.agentReady ?? undefined,
    lastVerifiedOn: day(item.lastVerifiedAt),
    installs: item.install?.trim() ? [installFromCommand(item.install)] : [],
    examples: (item.examples ?? []).map((e) => e.trim()).filter(Boolean),
  })
  b.identity({ repository, website: opt(item.homepage) })
    .flags({ official: !!item.official, verified: !!item.verified, featured: !!item.featured })
    .link('repository', repository ? repositoryUrl(repository) : undefined)
    .link('website', item.homepage)
    .author({ platform: 'github', login: item.owner, url: item.owner ? `https://github.com/${item.owner}` : undefined, role: 'owner' })
    .category(mapCategory('cli', item.category), item.category)
    .media('icon', githubOwnerAvatar(item.owner))
    .alias('command', item.command)
  for (const source of item.sources ?? []) b.link('source', source.url, opt(source.name))
  for (const alias of item.aliases ?? []) b.alias('command', alias)
  return b.build()
}

function mapSkill(record: Rec<'skill'>) {
  const { item } = record.data
  const repository =
    parseRepositoryUrl(item.repositoryUrl) ?? (item.owner && item.repository ? parseRepositoryUrl(`https://github.com/${item.owner}/${item.repository}`) : undefined)
  const b = start('skill', record, item, {
    canonicalKey: opt(item.canonicalKey),
    skillSlug: opt(item.skillSlug),
    installCommand: opt(item.installCommand),
    firstSeenOn: day(item.firstSeen),
    audits: (item.securityAudits ?? []).map(parseAudit).filter((a) => a.auditor),
  })
  b.identity({ skillKey: opt(item.canonicalKey), repository })
    .flags({ official: !!item.official, verified: !!item.verified, featured: !!item.featured })
    .text('description', 'en', item.description)
    .link('repository', item.repositoryUrl)
    .link('source', item.sourceUrl)
    .author({ platform: 'github', login: item.owner, url: item.owner ? `https://github.com/${item.owner}` : undefined, role: 'owner' })
    .category(mapCategory('skill', item.category), item.category)
    .tags(item.topics ?? [])
    .metric('skill_installs', item.installs)
    .metric('github_stars', item.stars)
    .alias('canonical_key', item.canonicalKey)
  for (const source of item.sources ?? []) b.link('source', source.url, opt(source.name))
  return b.build()
}

function mapLoop(record: Rec<'loop'>) {
  const { item } = record.data
  const agents = jsonField<unknown[]>({ issue: () => undefined }, 'supportedAgents', item.supportedAgents, [])
  const b = start('loop', record, item, {
    loopType: opt(item.type),
    maxIterations: item.maxIterations ?? undefined,
    // 检查命令是可执行的事实，原样保留；提示词、步骤说明等文字由我们自己生成（见 src/describe）
    checkCommand: opt(item.checkCommand),
    steps: [],
    supportedAgents: agents
      .filter((a): a is { name: string; active?: unknown } => !!a && typeof (a as { name?: unknown }).name === 'string')
      .map((a) => ({ name: a.name, active: a.active !== false })),
  })
  b.flags({ verified: !!item.verified, featured: !!item.featured })
    .set('sourceCreatedAt', iso(item.createdAt))
    .set('sourceUpdatedAt', iso(item.updatedAt))
    .category(mapCategory('loop', item.category), item.category)
    .metric('source_views', item.viewCount)
  return b.build()
}

function mapAgent(record: Rec<'agent'>) {
  const { item } = record.data
  const b = start('agent', record, item, { agentType: opt(item.type) })
  b.identity({ repository: parseRepositoryUrl(item.repositoryUrl), website: opt(item.websiteUrl) })
    .flags({ verified: !!item.verified, featured: !!item.featured })
    .set('sourceCreatedAt', iso(item.createdAt))
    .set('sourceUpdatedAt', iso(item.updatedAt))
    .link('website', item.websiteUrl)
    .link('repository', item.repositoryUrl)
    .author({ platform: 'other', login: item.authorName, displayName: opt(item.authorName), role: 'vendor' })
    .tags(strings(jsonField(b, 'tags', item.tags, [])))
    .media('icon', item.iconUrl, MCPSO_ORIGIN)
  strings(jsonField(b, 'categories', item.categories, [])).forEach((c, i) => b.category(mapCategory('agent', c), c, i === 0))
  for (const url of strings(jsonField(b, 'screenshots', item.screenshots, []))) b.media('screenshot', url, MCPSO_ORIGIN)
  return b.build()
}

const MAPPERS: { [K in EntityKind]: (record: Rec<K>) => EntityDraft } = {
  server: mapServer,
  client: mapClient,
  cli: mapCli,
  skill: mapSkill,
  loop: mapLoop,
  agent: mapAgent,
}

export class McpSoMapper implements Mapper<McpSoData> {
  /** 2：补全客户端分类映射；3：补全 CLI/Skill/Loop 分类，配置里有远程地址的服务算远程；4：Loop 保留检查命令；5：CLI 用所有者 GitHub 头像作图标；6：头像改用 github.com/<login>.png */
  readonly version = 6

  constructor(private readonly kind: EntityKind) {}

  map(record: SourceRecord<McpSoData>): EntityDraft {
    return (MAPPERS[this.kind] as (r: SourceRecord<McpSoData>) => EntityDraft)(record)
  }
}
