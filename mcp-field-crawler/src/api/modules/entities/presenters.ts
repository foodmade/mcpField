import type { EntityDraftOf, MetricName, ToolDraft } from '../../../core/draft.ts'
import type { EntityKind } from '../../../core/types.ts'

/**
 * 各类型的专有字段（策略模式）：通用的列表/详情字段由 EntityService 组装，
 * 这里只描述"这个类型额外返回什么"，新增类型时加一个 presenter 即可。
 */
export interface EntityPresenter<K extends EntityKind> {
  /** sort=popular 使用的热度指标 */
  popularMetric: MetricName
  /** 子类型字段的 JSON 路径，用于 type 筛选和计数；没有子类型时不填 */
  typePath?: string
  /** 列表卡片需要的少量专有字段 */
  list(d: EntityDraftOf<K>): Record<string, unknown>
  /** 详情页的完整专有字段 */
  detail(d: EntityDraftOf<K>): Record<string, unknown>
}

const metric = (d: { metrics: { metric: string; value: number }[] }, name: MetricName) => d.metrics.find((m) => m.metric === name)?.value ?? null
const orNull = <T>(v: T | undefined) => v ?? null

/** 工具定义的对外结构：收录的工具和实时读取的工具共用 */
export function presentTool(t: ToolDraft) {
  return {
    name: t.name,
    title: t.title ?? null,
    description: t.description ?? null,
    annotations: t.annotations ?? null,
    params: t.params.map((p) => ({ path: p.path, type: p.jsonType ?? null, description: p.description ?? null, required: p.required, enum: p.enumValues ?? null, default: p.defaultValue ?? null })),
  }
}

const server: EntityPresenter<'server'> = {
  popularMetric: 'github_stars',
  list: (d) => ({
    isRemote: d.detail.isRemote,
    runtime: orNull(d.detail.runtime),
    transports: d.detail.transports,
    toolsCount: d.detail.tools.length,
  }),
  detail: (d) => ({
    version: orNull(d.detail.version),
    authType: orNull(d.detail.authType),
    packages: d.detail.packages.map((p) => ({ registryType: p.registryType, identifier: p.identifier, version: orNull(p.version), runtimeHint: orNull(p.runtimeHint), transport: orNull(p.transport) })),
    // 只有变量名和说明，从不包含取值
    envVars: d.detail.envVars.map((e) => ({ name: e.name, description: orNull(e.description), required: e.required, secret: e.secret })),
    remotes: d.detail.remotes.map((r) => ({ transport: r.transport, url: r.url, authType: orNull(r.authType) })),
    tools: d.detail.tools.map(presentTool),
  }),
}

const client: EntityPresenter<'client'> = {
  popularMetric: 'github_stars',
  list: () => ({}),
  detail: (d) => ({ clientType: orNull(d.detail.clientType), runtime: orNull(d.detail.runtime) }),
}

const cli: EntityPresenter<'cli'> = {
  popularMetric: 'github_stars',
  list: (d) => ({
    command: orNull(d.detail.command),
    installCommand: d.detail.installs[0]?.command ?? null,
    agentReady: orNull(d.detail.agentReady),
  }),
  detail: (d) => ({
    cliType: orNull(d.detail.cliType),
    lastVerifiedOn: orNull(d.detail.lastVerifiedOn),
    installs: d.detail.installs,
    examples: d.detail.examples,
    aliases: d.aliases.filter((a) => a.type === 'command').map((a) => a.value),
  }),
}

const skill: EntityPresenter<'skill'> = {
  popularMetric: 'skill_installs',
  list: (d) => ({
    installs: metric(d, 'skill_installs'),
    installCommand: orNull(d.detail.installCommand),
  }),
  detail: (d) => ({
    canonicalKey: orNull(d.detail.canonicalKey),
    skillSlug: orNull(d.detail.skillSlug),
    firstSeenOn: orNull(d.detail.firstSeenOn),
    audits: d.detail.audits,
  }),
}

const loop: EntityPresenter<'loop'> = {
  popularMetric: 'source_views',
  list: (d) => ({ loopType: orNull(d.detail.loopType), maxIterations: orNull(d.detail.maxIterations) }),
  detail: (d) => ({ supportedAgents: d.detail.supportedAgents, checkCommand: orNull(d.detail.checkCommand) }),
}

const agent: EntityPresenter<'agent'> = {
  popularMetric: 'github_stars',
  typePath: '$.detail.agentType',
  list: (d) => ({ agentType: orNull(d.detail.agentType) }),
  detail: () => ({}),
}

export const PRESENTERS: { [K in EntityKind]: EntityPresenter<K> } = { server, client, cli, skill, loop, agent }

/** 每种类型的路由前缀，与 mcp-field 的页面路径一致 */
export const ROUTE_BY_KIND: Record<EntityKind, string> = {
  server: 'servers',
  client: 'clients',
  cli: 'cli',
  skill: 'skills',
  loop: 'loops',
  agent: 'agents',
}

/** 404 提示里的类型名 */
export const LABEL_BY_KIND: Record<EntityKind, string> = {
  server: 'MCP 服务',
  client: '客户端',
  cli: 'CLI',
  skill: 'Skill',
  loop: 'Loop',
  agent: 'Agent',
}
