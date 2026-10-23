import { useEffect, useSyncExternalStore } from 'react'
import { apiGet, apiSend } from './api/http'
import { accessToken, useSession } from './auth'

/*
 * API 密钥：与后端 mcp-field-crawler/src/api/modules/keys 对应。密钥给 MCP 服务（npm 包 mcpfield-mcp）用，
 * Agent 用 npx 在本机启动它，通过环境变量 MCPFIELD_API_KEY 传入密钥。完整密钥只在创建时返回一次。
 */

export const MCP_PACKAGE = 'mcpfield-mcp'
export const KEY_ENV = 'MCPFIELD_API_KEY'
export const KEYS_MAX = 10
export const NAME_MAX = 40
export const EXPIRY_OPTIONS = [30, 90, 365, null] as const
export type Expiry = (typeof EXPIRY_OPTIONS)[number]

export type ApiKey = {
  id: string
  name: string
  /** mf_8KQ2••••x7Pa */
  hint: string
  createdAt: string
  expiresAt: string | null
  expired: boolean
  lastUsedAt: string | null
  lastUsedClient: string | null
}

/* 当前账号的密钥列表：控制台侧栏的数量和密钥页共用；按账号加载一次，增删改后就地更新 */
type Store = { userId: string | null; list: ApiKey[] | null; failed: boolean }
let store: Store = { userId: null, list: null, failed: false }
let loading: string | null = null
const listeners = new Set<() => void>()
const set = (next: Store) => {
  store = next
  listeners.forEach((l) => l())
}
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

async function load(userId: string) {
  loading = userId
  try {
    const { data } = await apiGet<{ data: ApiKey[] }>('/keys', {}, undefined, await accessToken())
    if (store.userId === userId) set({ userId, list: data, failed: false })
  } catch {
    if (store.userId === userId) set({ ...store, failed: true })
  } finally {
    if (loading === userId) loading = null
  }
}

function ensureLoaded(userId: string | null) {
  if (store.userId !== userId) set({ userId, list: null, failed: false })
  if (userId && !store.list && !store.failed && loading !== userId) void load(userId)
}

const update = (fn: (list: ApiKey[]) => ApiKey[]) => store.list && set({ ...store, list: fn(store.list) })

/** 当前账号的密钥；list 为 null 表示还没读到（未登录时一直为 null） */
export function useApiKeys() {
  const { user, pending } = useSession()
  const userId = user?.id ?? null
  useEffect(() => {
    if (!pending) ensureLoaded(userId)
  }, [userId, pending])
  const snapshot = useSyncExternalStore(subscribe, () => store, () => store)
  const mine = snapshot.userId === userId
  return {
    list: mine ? snapshot.list : null,
    failed: mine && snapshot.failed,
    reload: () => {
      if (!userId) return
      set({ userId, list: null, failed: false })
      void load(userId)
    },
  }
}

/** 创建密钥：返回完整密钥（只有这一次）并加进列表 */
export async function createKey(name: string, expiresInDays: Expiry): Promise<{ key: string; item: ApiKey }> {
  const { data } = await apiSend<{ data: { key: string; item: ApiKey } }>('POST', '/keys', { name, expiresInDays }, await accessToken())
  update((list) => [data.item, ...list])
  return data
}

export async function renameKey(id: string, name: string): Promise<void> {
  const { data } = await apiSend<{ data: ApiKey }>('PUT', `/keys/${id}`, { name }, await accessToken())
  update((list) => list.map((k) => (k.id === id ? data : k)))
}

/** 撤销（删除）；过期的密钥也用它删 */
export async function removeKey(id: string): Promise<void> {
  await apiSend('DELETE', `/keys/${id}`, undefined, await accessToken())
  update((list) => list.filter((k) => k.id !== id))
}

/* 各客户端接入 MCP 服务的配置：key 是完整密钥，或者「<你的 API 密钥>」这样的占位文字 */
export const CONNECT_CLIENTS = ['claude-code', 'codex', 'gemini-cli', 'cursor', 'other'] as const
export type ConnectClient = (typeof CONNECT_CLIENTS)[number]
export const CONNECT_LABELS: Record<Exclude<ConnectClient, 'other'>, string> = { 'claude-code': 'Claude Code', codex: 'Codex', 'gemini-cli': 'Gemini CLI', cursor: 'Cursor' }

const jsonConfig = (key: string) => JSON.stringify({ mcpServers: { mcpfield: { command: 'npx', args: ['-y', MCP_PACKAGE], env: { [KEY_ENV]: key } } } }, null, 2)

/** file 为 null 时是在终端运行的命令 */
export function connectConfig(client: ConnectClient, key: string): { file: string | null; code: string } {
  switch (client) {
    case 'claude-code':
      return { file: null, code: `claude mcp add mcpfield --scope user \\\n  --env ${KEY_ENV}=${key} \\\n  -- npx -y ${MCP_PACKAGE}` }
    case 'codex':
      return { file: '~/.codex/config.toml', code: `[mcp_servers.mcpfield]\ncommand = "npx"\nargs = ["-y", "${MCP_PACKAGE}"]\nenv = { ${KEY_ENV} = "${key}" }` }
    case 'gemini-cli':
      return { file: '~/.gemini/settings.json', code: jsonConfig(key) }
    case 'cursor':
      return { file: '~/.cursor/mcp.json', code: jsonConfig(key) }
    default:
      return { file: 'mcpServers', code: jsonConfig(key) }
  }
}
