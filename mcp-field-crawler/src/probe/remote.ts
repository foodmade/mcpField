import { sql } from 'drizzle-orm'
import type { RemoteDraft } from '../core/draft.ts'
import { remoteKey } from '../core/identity.ts'
import type { Db } from '../db/client.ts'
import { listRemoteTools } from './mcp-remote.ts'
import { PROBE_TOOLS_ENRICHER, type ToolsProbeResult } from './tools-store.ts'

/*
 * 远程服务（Streamable HTTP）工具列表的实测：官方 Registry 不提供工具列表，这类服务原本只在打开页面时实时读取，
 * 读到的工具没有存下来，工具翻译（translate-tools）也就收集不到。实测结果和本地服务的一样存进 ingest_enrichments，
 * publish 时补给条目。请求从实测机发出（probe-worker），第三方地址不从线上服务器访问。
 */

export interface RemoteProbeTarget {
  /** remote:<host/path>，同时是 ingest_enrichments 的主体键 */
  key: string
  registryType: 'remote'
  url: string
  transport: string
  /** 使用这个地址的条目中最高的星数，决定实测顺序 */
  stars: number | null
}

/** 优先用 Streamable HTTP，SSE 读不了（listRemoteTools 会返回 unsupported） */
export function pickRemote(remotes: RemoteDraft[]): RemoteDraft | undefined {
  return remotes.find((r) => r.transport !== 'sse') ?? remotes[0]
}

/** 发布层里有远程地址、还没有工具列表的服务，按地址去重；近期测过的（结果未过期）跳过 */
export async function collectRemoteTargets(db: Db): Promise<RemoteProbeTarget[]> {
  const [rows] = (await db.execute(sql`
    SELECT s.pop_rank AS popRank, JSON_EXTRACT(d.draft, '$.detail.remotes') AS remotes
    FROM ingest_published d
    LEFT JOIN ingest_search s ON s.kind = d.kind AND s.locale = 'en' AND s.slug = d.slug
    WHERE d.kind = 'server'
      AND COALESCE(JSON_LENGTH(d.draft, '$.detail.tools'), 0) = 0
      AND JSON_LENGTH(d.draft, '$.detail.remotes') > 0`)) as unknown as [{ popRank: number | null; remotes: unknown }[]]
  const [fresh] = (await db.execute(sql`
    SELECT subject_key AS subjectKey FROM ingest_enrichments
    WHERE enricher = ${PROBE_TOOLS_ENRICHER} AND subject_key LIKE 'remote:%' AND (expires_at IS NULL OR expires_at > NOW())`)) as unknown as [{ subjectKey: string }[]]
  const skip = new Set(fresh.map((r) => r.subjectKey))

  const targets = new Map<string, RemoteProbeTarget>()
  for (const row of rows) {
    const remotes = (typeof row.remotes === 'string' ? JSON.parse(row.remotes) : row.remotes) as RemoteDraft[] | null
    const remote = pickRemote(remotes ?? [])
    const key = remoteKey(remote?.url)
    if (!remote || !key || skip.has(key)) continue
    const stars = row.popRank === null ? null : -Number(row.popRank)
    const existing = targets.get(key)
    if (existing) {
      if (stars !== null && (existing.stars === null || stars > existing.stars)) existing.stars = stars
      continue
    }
    targets.set(key, { key, registryType: 'remote', url: remote.url, transport: remote.transport, stars })
  }
  return [...targets.values()].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))
}

/** 读一次 tools/list；需要鉴权、网络不通、协议出错都如实记下状态 */
export async function probeRemote(target: RemoteProbeTarget): Promise<ToolsProbeResult> {
  const result = await listRemoteTools(target.url, target.transport)
  const probedAt = new Date().toISOString()
  if ('tools' in result) return { key: target.key, status: 'ok', tools: result.tools, probedAt }
  return { key: target.key, status: result.error, ...(result.status ? { error: `HTTP ${result.status}` } : {}), probedAt }
}
