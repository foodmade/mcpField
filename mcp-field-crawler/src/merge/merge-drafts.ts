import type { EntityDraft, IdentityHints, MetricDraft, RepositoryRef, ServerDetailDraft, SkillAuditDraft, SkillDetailDraft } from '../core/draft.ts'

/*
 * 把同一组的各来源草稿合并成一份（字段级取舍，见 docs/DESIGN.md 第 6 节）。
 * 结果的结构与普通草稿相同，网站和各生成任务不用区分它来自几个来源。
 */

/** 展示类字段（名称、简介、分类、标签、图标……）的来源优先级：mcp.so 有人工整理的分类和标签，且已有的地址和生成内容都挂在它上面 */
const DISPLAY_ORDER = ['mcpso', 'mcp-registry']
/** 安装信息（安装包、远程端点、环境变量）的来源优先级：Registry 是发布者自己登记的；mcp.so 的配置可能被换成它的代理 */
const INSTALL_ORDER = ['mcp-registry', 'mcpso']

const rank = (order: string[], sourceId: string) => (order.includes(sourceId) ? order.indexOf(sourceId) : order.length)
/** 展示优先级的名次（越小越优先）：分配 slug 时，mcp.so 的条目先保住已有地址 */
export const displayRank = (sourceId: string) => rank(DISPLAY_ORDER, sourceId)
const byOrder = (drafts: EntityDraft[], order: string[]) => [...drafts].sort((a, b) => rank(order, a.sourceId) - rank(order, b.sourceId))

/** mcp.so 给重复收录的条目加的随机后缀：firecrawl-6afd09 */
const RANDOM_SUFFIX = /-[0-9a-f]{6}$/

/** 选择主条目需要的最少信息（合并预演阶段只加载了这些） */
export interface PrimaryCandidate {
  sourceId: string
  externalId: string
  slug: string
}

/**
 * 主条目：按展示优先级选来源（有 mcp.so 的用 mcp.so，沿用已有地址和生成内容）；
 * 同一来源里有多条时，不带随机后缀的、slug 短的优先。
 */
export function pickPrimary<T extends PrimaryCandidate>(members: T[]): T {
  return [...members].sort(
    (a, b) =>
      rank(DISPLAY_ORDER, a.sourceId) - rank(DISPLAY_ORDER, b.sourceId) ||
      Number(RANDOM_SUFFIX.test(a.slug)) - Number(RANDOM_SUFFIX.test(b.slug)) ||
      a.slug.length - b.slug.length ||
      a.externalId.localeCompare(b.externalId),
  )[0]!
}

const words = (value: string) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)
const NAME_STOPWORDS = new Set(['mcp', 'server', 'the', 'and', 'for', 'api'])
/** 被当成名称的 README 小节标题（2026-10 mcp.so 实测："Introduction""Getting Started""License"……） */
const README_HEADINGS = new Set(
  [
    'introduction', 'overview', 'setup', 'install', 'installation', 'getting started', 'quick start', 'quickstart', 'quickstart resources',
    'description', 'project', 'project name', 'project description', 'project overview', 'project setup', 'project setup guide',
    'usage', 'usage examples', 'examples', 'example', 'license', 'credits', 'acknowledgments', 'acknowledgements', 'readme', 'github',
    'summary', 'reference', 'foreword', 'features', 'tools', 'build', 'building', 'requirements', 'prerequisites', 'configuration',
    'security considerations', 'table of contents', 'contents', 'org', 'website', 'image', 'model context protocol',
  ],
)

/**
 * 源站名称明显填错：mcp.so 有些条目的名称是 README 的小节标题（"Introduction""License"）、作者名或重复词（microsoft/playwright-mcp 叫"Slack Slack"）。
 * 只在映射时已标记为可疑、且名称与仓库所有者和仓库名没有共同词时才判定，避免误伤作者就是公司本身的条目（"PayPal" ↔ paypal/agent-toolkit）。
 * 填成提交者人名的（microsoft/vscode 叫"Geng"）与正常的单词品牌名分不开，不在这里处理，留给人工修正。
 */
export function hasBrokenName(d: EntityDraft): boolean {
  if (!d.issues.some((i) => i.code === 'suspicious_name')) return false
  const name = words(d.name)
  const repo = d.identity.repository
  const repoWords = new Set(repo ? [...words(repo.owner), ...words(repo.name)] : [])
  if (name.some((w) => repoWords.has(w) || [...repoWords].some((r) => r.includes(w) || w.includes(r)))) return false
  const isAuthor = d.authors.some((a) => [a.displayName, a.login].some((v) => v && v.trim().toLowerCase() === d.name.trim().toLowerCase()))
  const repeated = name.some((w, i) => i > 0 && w === name[i - 1] && !NAME_STOPWORDS.has(w))
  const heading = README_HEADINGS.has(d.name.trim().toLowerCase().replace(/\s+/g, ' '))
  return isAuthor || repeated || heading
}

/** 名称填错时的替代：其他来源的名称，其次仓库名（monorepo 取子目录名） */
function fallbackName(d: EntityDraft, others: EntityDraft[]): string {
  const other = first(others, (o) => (hasBrokenName(o) ? undefined : o.name))
  if (other) return other
  const repo = d.identity.repository
  return repo ? repo.path.split('/').filter(Boolean).at(-1) || repo.name : d.name
}

function nonEmpty<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

function first<T>(drafts: EntityDraft[], get: (d: EntityDraft) => T | undefined | null): T | undefined {
  for (const d of drafts) {
    const value = get(d)
    if (nonEmpty(value)) return value
  }
  return undefined
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const latest = (values: (string | undefined)[]) => values.filter(nonEmpty).sort().at(-1)
const earliest = (values: (string | undefined)[]) => values.filter(nonEmpty).sort()[0]

/** 仓库：同一组里只会有同一个仓库的根目录与子目录（见合并规则），取最具体的那个 */
function pickRepository(drafts: EntityDraft[]): RepositoryRef | undefined {
  const refs = drafts.map((d) => d.identity.repository).filter(nonEmpty)
  return refs.find((r) => r.path) ?? refs[0]
}

function mergeIdentity(display: EntityDraft[], install: EntityDraft[]): IdentityHints {
  const identity: IdentityHints = {}
  const set = <K extends keyof IdentityHints>(key: K, value: IdentityHints[K] | undefined) => {
    if (value !== undefined) identity[key] = value
  }
  set('skillKey', first(display, (d) => d.identity.skillKey))
  set('repository', pickRepository(display))
  set('registryName', first(install, (d) => d.identity.registryName))
  set('npmPackage', first(install, (d) => d.identity.npmPackage))
  set('pypiPackage', first(install, (d) => d.identity.pypiPackage))
  set('remoteUrl', first(install, (d) => d.identity.remoteUrl))
  set('website', first(display, (d) => d.identity.website))
  return identity
}

/** 同一指标取各来源的最大值（星数、安装量都是只增不减的累计值） */
function mergeMetrics(drafts: EntityDraft[]): MetricDraft[] {
  const best = new Map<string, MetricDraft>()
  for (const m of drafts.flatMap((d) => d.metrics)) {
    const key = `${m.metric}:${m.period}`
    const prev = best.get(key)
    if (!prev || m.value > prev.value) best.set(key, m)
  }
  return [...best.values()]
}

function mergeServerDetail(primary: ServerDetailDraft, display: EntityDraft[], install: EntityDraft[]): ServerDetailDraft {
  const details = (list: EntityDraft[]) => list.map((d) => d.detail as ServerDetailDraft)
  // 安装包、环境变量、远程端点、传输方式取自同一个来源，保持一致
  const installFrom = details(install).find((d) => d.packages.length > 0 || d.remotes.length > 0) ?? primary
  const toolsFrom = details(display).reduce((a, b) => (b.tools.length > a.tools.length ? b : a), primary)
  const detail: ServerDetailDraft = {
    ...primary,
    transports: installFrom.transports.length > 0 ? installFrom.transports : primary.transports,
    packages: installFrom.packages,
    envVars: installFrom.envVars,
    remotes: installFrom.remotes,
    tools: toolsFrom.tools,
    isRemote: details(display).some((d) => d.isRemote) || installFrom.remotes.length > 0,
  }
  for (const field of ['runtime', 'version', 'authType'] as const) {
    const value = first(display, (d) => (d.detail as ServerDetailDraft)[field])
    if (value !== undefined) detail[field] = value
  }
  return detail
}

/** 审计的信息量：带风险等级或摘要的（skills.sh）比只有结论的（mcp.so）有用得多 */
const auditScore = (audits: SkillAuditDraft[]) => audits.length + 10 * audits.filter((a) => a.riskLevel || a.summary).length

function mergeSkillDetail(primary: SkillDetailDraft, display: EntityDraft[]): SkillDetailDraft {
  const details = display.map((d) => d.detail as SkillDetailDraft)
  const detail: SkillDetailDraft = { ...primary, audits: details.reduce((a, b) => (auditScore(b.audits) > auditScore(a.audits) ? b : a), primary).audits }
  for (const field of ['canonicalKey', 'skillSlug', 'installCommand', 'firstSeenOn'] as const) {
    const value = first(display, (d) => (d.detail as SkillDetailDraft)[field])
    if (value !== undefined) detail[field] = value
  }
  const files = first(display, (d) => (d.detail as SkillDetailDraft).files)
  if (files) detail.files = files
  return detail
}

/**
 * 合并一组草稿。members 里要包含主条目；slug、identityKey 由发布阶段分配。
 * 源站收录的 README 文本（texts.readme）不进入结果：README 只用从 GitHub 抓取的原文。
 */
export function mergeDrafts(members: EntityDraft[], options: { primary: EntityDraft; slug: string; identityKey: string }): EntityDraft {
  const { primary } = options
  const others = members.filter((d) => d !== primary)
  const display = [primary, ...byOrder(others, DISPLAY_ORDER)]
  const install = byOrder(members, INSTALL_ORDER)

  const identity = mergeIdentity(display, install)
  const merged = structuredClone(primary) as EntityDraft
  merged.slug = options.slug
  merged.identityKey = options.identityKey
  merged.identity = identity
  if (identity.repository) merged.repository = identity.repository
  else delete merged.repository

  if (hasBrokenName(merged)) merged.name = fallbackName(merged, others)

  merged.flags = {
    ...(display.some((d) => d.flags.official) ? { official: true } : {}),
    ...(display.some((d) => d.flags.verified) ? { verified: true } : {}),
    ...(display.some((d) => d.flags.featured) ? { featured: true } : {}),
  }
  const license = first(display, (d) => d.license)
  if (license) merged.license = license
  const created = earliest(members.map((d) => d.sourceCreatedAt))
  const updated = latest(members.map((d) => d.sourceUpdatedAt))
  const commit = latest(members.map((d) => d.lastCommitAt))
  if (created) merged.sourceCreatedAt = created
  if (updated) merged.sourceUpdatedAt = updated
  if (commit) merged.lastCommitAt = commit

  // 每个字段 × 语言取展示优先级最高的来源
  merged.texts = unique(
    display.flatMap((d) => d.texts.filter((t) => t.field !== 'readme')),
    (t) => `${t.field}:${t.locale}`,
  )
  // 每个来源的条目地址记为 source 链接（label 是数据源 ID），详情页据此列出"收录来源"
  const sourceLinks = display.map((d) => ({ type: 'source' as const, url: d.sourceUrl, label: d.sourceId }))
  merged.links = unique(
    [...display.flatMap((d) => d.links), ...sourceLinks],
    (l) => `${l.type}:${l.url}`,
  )
  merged.authors = unique(
    display.flatMap((d) => d.authors),
    (a) => `${a.platform}:${a.login.toLowerCase()}:${a.role}`,
  )
  merged.categories = first(display, (d) => d.categories) ?? []
  merged.tags = unique(
    display.flatMap((d) => d.tags),
    (t) => t,
  )
  merged.metrics = mergeMetrics(members)
  const icon = first(display, (d) => d.media.find((m) => m.type === 'icon'))
  merged.media = unique(
    [...(icon ? [icon] : []), ...display.flatMap((d) => d.media.filter((m) => m.type !== 'icon'))],
    (m) => `${m.type}:${m.url}`,
  )
  // 被合并进来的 mcp.so 重复条目，原来的地址记为旧 slug
  const previous = others.filter((d) => d.sourceId === primary.sourceId && d.slug !== options.slug).map((d) => ({ type: 'previous_slug' as const, value: d.slug }))
  merged.aliases = unique([...display.flatMap((d) => d.aliases), ...previous], (a) => `${a.type}:${a.value}`)
  merged.listItems = first(display, (d) => d.listItems) ?? []
  merged.platforms = [...new Set(display.flatMap((d) => d.platforms))]
  if (primary.kind === 'server') merged.detail = mergeServerDetail(primary.detail as ServerDetailDraft, display, install)
  if (primary.kind === 'skill') merged.detail = mergeSkillDetail(primary.detail as SkillDetailDraft, display)
  merged.issues = primary.issues.filter((i) => !(i.code === 'missing_repository' && identity.repository))
  return merged
}
