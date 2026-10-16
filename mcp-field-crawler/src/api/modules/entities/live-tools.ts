import type { Locale } from '../../../core/types.ts'
import type { ProbeResult } from '../../../probe/mcp-remote.ts'
import type { EntityService } from './entity.service.ts'
import { presentTool } from './presenters.ts'

type Probe = (url: string, transport: string) => Promise<ProbeResult>

const TTL_MS = 10 * 60 * 1000

/**
 * 远程服务工具列表的实时读取：地址取自收录数据（不接受前端传入的 URL），
 * 同一服务 10 分钟内复用结果，并发请求合并为一次，避免把接口当成代理反复打到第三方服务。
 */
export class LiveToolsService {
  private readonly cache = new Map<string, { at: number; result: Promise<ProbeResult> }>()

  constructor(
    private readonly servers: EntityService<'server'>,
    private readonly probe: Probe,
  ) {}

  /** 服务不存在返回 null；不是远程服务返回 unsupported */
  async get(slug: string, locale: Locale = 'en') {
    const server = await this.servers.get(slug)
    if (!server) return null
    const remotes = (server.remotes ?? []) as { url: string; transport: string }[]
    const remote = remotes.find((r) => r.transport !== 'sse') ?? remotes[0]
    if (!remote) return { error: 'unsupported', fetchedAt: new Date().toISOString() }

    const hit = this.cache.get(slug)
    const fresh = hit && Date.now() - hit.at < TTL_MS
    const entry = fresh ? hit : { at: Date.now(), result: this.probe(remote.url, remote.transport) }
    if (!fresh) this.cache.set(slug, entry)
    const result = await entry.result
    // 网络错误不缓存，下次可以立即重试
    if ('error' in result && result.error === 'network') this.cache.delete(slug)
    const fetchedAt = new Date(entry.at).toISOString()
    if (!('tools' in result)) return { ...result, fetchedAt }
    // 实时读取的工具大多与收录的相同，已有译文直接用；不会为它新翻译
    const tools = result.tools.map(presentTool)
    await this.servers.localizeTools(tools, locale)
    return { tools, fetchedAt }
  }
}
