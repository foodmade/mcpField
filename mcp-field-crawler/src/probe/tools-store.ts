import { and, eq, inArray, sql } from 'drizzle-orm'
import type { EntityDraft } from '../core/draft.ts'
import { npmKey, parseRepositoryUrl, pypiKey, remoteKey, repoKey } from '../core/identity.ts'
import type { Db } from '../db/client.ts'
import { ingestEnrichments } from '../db/schema/index.ts'
import { toToolDrafts } from '../extract/mcp-tools.ts'

/*
 * 工具列表的实测结果：存在 ingest_enrichments（enricher = probe_tools），publish 时补给没有工具列表的服务。
 * 本地服务一个安装包一行（npm:… / pypi:…，probe/local-*），远程服务一个地址一行（remote:…，probe/remote.ts）
 */

export const PROBE_TOOLS_ENRICHER = 'probe_tools'

/** ok / install_failed：装不上 / no_bin：包里没有可执行入口 / start_failed：启动后退出 / timeout / protocol：MCP 握手或 tools/list 出错 */
export type LocalProbeStatus = 'ok' | 'install_failed' | 'no_bin' | 'start_failed' | 'timeout' | 'protocol'

/** 远程服务另外几种：auth：要鉴权 / network：连不上或超时 / unsupported：只有 SSE / blocked：地址不是公网 HTTPS */
export type ProbeStatus = LocalProbeStatus | 'auth' | 'network' | 'unsupported' | 'blocked'

/** 实测结果，JSONL 的一行（实测机写出，probe-import 读入） */
export interface LocalProbeResult {
  key: string
  status: LocalProbeStatus
  error?: string
  /** 实际装上的版本、启动的入口 */
  version?: string
  bin?: string
  /** 启动时实际用的参数（没有参数时省略） */
  args?: string[]
  /** 包元数据里的源码仓库（npm repository / PyPI Project-URL）和官方 Registry 名称（npm mcpName / PyPI 简介里的 mcp-name:），用来核对包属于哪个条目 */
  repository?: string
  mcpName?: string
  server?: { name?: string; version?: string }
  /** tools/list 的原始结果 */
  tools?: unknown[]
  probedAt: string
}

/** 本地或远程的实测结果（存储和队列传输都用它） */
export type ToolsProbeResult = Omit<LocalProbeResult, 'status'> & { status: ProbeStatus }

export type ProbedTools = Pick<LocalProbeResult, 'repository' | 'mcpName' | 'version' | 'tools' | 'probedAt'>

const DAY = 24 * 60 * 60 * 1000
/**
 * 本地包：成功的 30 天后重测（包会更新）；超时多半是机器忙，7 天后重试；其余失败 30 天内不再测。
 * 远程服务：工具随部署更新，成功的 7 天后重读；连不上的 3 天后重试；要鉴权、只有 SSE、地址不合规的 30 天后再看
 */
const ttl = (status: ProbeStatus, key: string) => {
  if (!key.startsWith('remote:')) return (status === 'timeout' ? 7 : 30) * DAY
  return (status === 'ok' || status === 'protocol' ? 7 : status === 'network' ? 3 : 30) * DAY
}

const CHUNK = 500

export class ProbedToolsStore {
  constructor(private readonly db: Db) {}

  async save(results: ToolsProbeResult[]): Promise<void> {
    for (let i = 0; i < results.length; i += CHUNK) {
      const rows = results.slice(i, i + CHUNK).map((r) => {
        const fetchedAt = new Date(r.probedAt)
        const { key, status, error, probedAt: _at, ...data } = r
        return {
          enricher: PROBE_TOOLS_ENRICHER,
          subjectKey: key,
          status,
          data,
          error: error?.slice(0, 1024) ?? null,
          fetchedAt,
          expiresAt: new Date(fetchedAt.getTime() + ttl(status, key)),
        }
      })
      await this.db
        .insert(ingestEnrichments)
        .values(rows)
        .onDuplicateKeyUpdate({
          set: { status: sql`VALUES(status)`, data: sql`VALUES(data)`, error: sql`VALUES(error)`, fetchedAt: sql`VALUES(fetched_at)`, expiresAt: sql`VALUES(expires_at)` },
        })
    }
  }

  /** 只取成功的 */
  async find(keys: string[]): Promise<Map<string, ProbedTools>> {
    const out = new Map<string, ProbedTools>()
    const unique = [...new Set(keys)]
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await this.db
        .select({ key: ingestEnrichments.subjectKey, data: ingestEnrichments.data, fetchedAt: ingestEnrichments.fetchedAt })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, PROBE_TOOLS_ENRICHER), eq(ingestEnrichments.status, 'ok'), inArray(ingestEnrichments.subjectKey, unique.slice(i, i + CHUNK))))
      for (const r of rows) {
        const data = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as ProbedTools | null
        if (data) out.set(r.key, { ...data, probedAt: r.fetchedAt.toISOString() })
      }
    }
    return out
  }
}

/** 没有工具列表的服务的实测键：npm / PyPI 包键在前，远程地址键在后；其余条目返回空 */
export function probeKeys(draft: EntityDraft): string[] {
  if (draft.kind !== 'server' || draft.detail.tools.length > 0) return []
  return [
    ...draft.detail.packages.map((p) => (p.registryType === 'npm' ? npmKey(p.identifier) : p.registryType === 'pypi' ? pypiKey(p.identifier) : undefined)),
    ...draft.detail.remotes.map((r) => remoteKey(r.url)),
  ].filter((k): k is string => !!k)
}

/** npm 的仓库简写：owner/repo、github:owner/repo、gitlab:owner/repo */
const NPM_SHORTHAND = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/
const SHORTHAND_HOSTS: Record<string, string> = { github: 'github.com', gitlab: 'gitlab.com', bitbucket: 'bitbucket.org' }

/** 不看子目录的仓库键：monorepo 里的包，元数据通常只写到仓库根 */
export const repoRoot = (url: string | undefined) => {
  const short = url?.trim().match(NPM_SHORTHAND)
  const ref = parseRepositoryUrl(short ? `https://${SHORTHAND_HOSTS[short[1] ?? 'github']}/${short[2]}` : url)
  return ref ? repoKey({ ...ref, path: '' }) : undefined
}

/**
 * 包确实属于这个条目才用它的工具：包元数据里的仓库与条目的仓库一致，或包声明的 Registry 名称就是这个条目。
 * mcp.so 的安装包是从 README 的安装命令里摘的，常常摘到别的东西（firecrawl 摘成了 firecrawl-cli，context7 摘成了 ctx7）。
 */
export function probeBelongs(draft: EntityDraft, probe: ProbedTools): boolean {
  const registryName = draft.identity.registryName?.trim().toLowerCase()
  if (registryName && probe.mcpName?.trim().toLowerCase() === registryName) return true
  const own = draft.repository ? repoKey({ ...draft.repository, path: '' }) : undefined
  return !!own && repoRoot(probe.repository) === own
}

/** 给没有工具列表的服务补上实测结果；返回是否补上 */
export function applyProbedTools(draft: EntityDraft, probes: Map<string, ProbedTools>): boolean {
  if (draft.kind !== 'server') return false
  for (const key of probeKeys(draft)) {
    const probe = probes.get(key)
    // 远程地址取自条目自己的收录数据，不用再核对归属；安装包要核对（见 probeBelongs）
    if (!probe?.tools?.length || (!key.startsWith('remote:') && !probeBelongs(draft, probe))) continue
    draft.detail.tools = toToolDrafts(probe.tools)
    return draft.detail.tools.length > 0
  }
  return false
}
