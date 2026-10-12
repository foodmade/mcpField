export const REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io'
/** v0.1 是当前的稳定版本；v0 仍可用但不再更新 */
export const REGISTRY_API = `${REGISTRY_ORIGIN}/v0.1`

/** 列表接口：只取每个服务的最新版本；since 对应 updated_since，只列出之后有变化的 */
export function listUrl(options: { cursor?: string; since?: Date; limit?: number } = {}): string {
  const url = new URL(`${REGISTRY_API}/servers`)
  url.searchParams.set('limit', String(options.limit ?? 100))
  url.searchParams.set('version', 'latest')
  if (options.since) url.searchParams.set('updated_since', options.since.toISOString())
  if (options.cursor) url.searchParams.set('cursor', options.cursor)
  return url.toString()
}

/** 单个服务最新版本的详情地址，作为目标的稳定 URL（数据实际取自列表接口，见 PrefetchFetcher） */
export function serverUrl(name: string): string {
  return `${REGISTRY_API}/servers/${encodeURIComponent(name)}/versions/latest`
}
