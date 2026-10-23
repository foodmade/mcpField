import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { AuthUser, AuthVerifier } from '../src/api/auth/supabase-auth.ts'
import type { FavoriteRepository } from '../src/api/modules/favorites/favorite.repository.ts'
import { FavoriteService } from '../src/api/modules/favorites/favorite.service.ts'
import type { ApiKeyRepository, ApiKeyRow, NewApiKey } from '../src/api/modules/keys/key.repository.ts'
import { ApiKeyService, hashKey, KEYS_MAX, type ApiKeyDto } from '../src/api/modules/keys/key.service.ts'
import type { Logger } from '../src/core/logger.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

class MemoryKeys implements ApiKeyRepository {
  rows: (ApiKeyRow & { keyHash: string })[] = []
  touches: { id: number; at: Date; client: string | null }[] = []
  private seq = 0
  constructor(private readonly clock: { now: number }) {}
  async list(userId: string) {
    return this.rows.filter((r) => r.userId === userId).sort((a, b) => b.id - a.id)
  }
  async insert(row: NewApiKey) {
    const r = { ...row, id: ++this.seq, lastUsedAt: null, lastUsedClient: null, createdAt: new Date(this.clock.now) }
    this.rows.push(r)
    return r
  }
  async find(id: number) {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async findByHash(keyHash: string) {
    return this.rows.find((r) => r.keyHash === keyHash) ?? null
  }
  async rename(id: number, name: string) {
    this.rows.find((r) => r.id === id)!.name = name
  }
  async remove(id: number) {
    this.rows = this.rows.filter((r) => r.id !== id)
  }
  async touch(id: number, at: Date, client: string | null) {
    this.touches.push({ id, at, client })
    const r = this.rows.find((x) => x.id === id)!
    r.lastUsedAt = at
    if (client) r.lastUsedClient = client
  }
}

/** 收藏只需要能走通鉴权：keys 返回空列表 */
const emptyFavorites: FavoriteRepository = {
  resolve: async () => new Map(),
  list: async () => [],
  count: async () => 0,
  add: async () => undefined,
  remove: async () => undefined,
}

const USERS: Record<string, AuthUser> = {
  'token-lina': { id: 'u-lina', name: 'lina-dev', avatar: null },
  'token-kenji': { id: 'u-kenji', name: 'kenji', avatar: null },
}
const fakeAuth: AuthVerifier = { verify: async (t) => USERS[t] ?? null }

function setup() {
  const clock = { now: Date.UTC(2026, 9, 23) }
  const repo = new MemoryKeys(clock)
  const keys = new ApiKeyService(repo, () => clock.now)
  const app = createApp({ entities: {}, apiKeys: keys, favorites: new FavoriteService(emptyFavorites, async () => []), auth: fakeAuth, logger: silent })
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; client?: string } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.client ? { 'x-mcpfield-client': opts.client } : {}),
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  const create = async (name = 'MacBook · Claude Code', expiresInDays: number | null = 90, token = 'token-lina') => {
    const res = await call('POST', '/api/keys', { token, body: { name, expiresInDays } })
    return { res, data: res.status === 201 ? ((await res.json()) as { data: { key: string; item: ApiKeyDto } }).data : null }
  }
  const list = async (token = 'token-lina') => ((await (await call('GET', '/api/keys', { token })).json()) as { data: ApiKeyDto[] }).data
  return { clock, repo, call, create, list }
}

describe('API 密钥管理', () => {
  it('创建时返回一次完整密钥，库里只存哈希；列表只给提示', async () => {
    const { create, list, repo } = setup()
    const { res, data } = await create()
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(data!.key).toMatch(/^mf_[A-Za-z0-9]{36}$/)
    const body = data!.key.slice(3)
    expect(data!.item).toMatchObject({ name: 'MacBook · Claude Code', hint: `mf_${body.slice(0, 4)}••••${body.slice(-4)}`, expired: false, lastUsedAt: null, expiresAt: new Date(Date.UTC(2026, 9, 23) + 90 * 86_400_000).toISOString() })
    expect(repo.rows[0]!.keyHash).toBe(hashKey(data!.key))
    expect(JSON.stringify(repo.rows)).not.toContain(data!.key)
    const items = await list()
    expect(items).toHaveLength(1)
    expect(JSON.stringify(items)).not.toContain(data!.key)
  })

  it('名称必填且最多 40 字；有效期只能选 30、90、365 天或永不过期', async () => {
    const { create } = setup()
    expect((await create('   ')).res.status).toBe(400)
    expect((await create('字'.repeat(41))).res.status).toBe(400)
    expect((await create('ok', 7)).res.status).toBe(400)
    expect((await create('forever', null)).data!.item.expiresAt).toBeNull()
  })

  it('最多 10 个有效密钥，已过期的不算', async () => {
    const { create, clock } = setup()
    await create('old', 30)
    clock.now += 31 * 86_400_000
    for (let i = 0; i < KEYS_MAX; i++) expect((await create(`k${i}`)).res.status).toBe(201)
    const over = await create('one more')
    expect(over.res.status).toBe(400)
    expect(((await over.res.json()) as { error: { code: string } }).error.code).toBe('limit_reached')
  })

  it('只能改、删自己的密钥；管理接口不接受 API 密钥', async () => {
    const { create, call, list } = setup()
    const { data } = await create()
    const id = data!.item.id
    expect((await call('PUT', `/api/keys/${id}`, { token: 'token-kenji', body: { name: 'mine' } })).status).toBe(404)
    expect((await call('DELETE', `/api/keys/${id}`, { token: 'token-kenji' })).status).toBe(404)
    expect((await call('GET', '/api/keys', { token: data!.key })).status).toBe(401)
    expect((await call('POST', '/api/keys', { token: data!.key, body: { name: 'x' } })).status).toBe(401)
    const renamed = await call('PUT', `/api/keys/${id}`, { token: 'token-lina', body: { name: '  工作站   Codex ' } })
    expect(((await renamed.json()) as { data: ApiKeyDto }).data.name).toBe('工作站 Codex')
    expect((await call('DELETE', `/api/keys/${id}`, { token: 'token-lina' })).status).toBe(204)
    expect(await list()).toEqual([])
  })
})

describe('用 API 密钥调用收藏接口', () => {
  it('有效密钥代表创建它的账号；记下使用时间和客户端', async () => {
    const { create, call, list, repo } = setup()
    const { data } = await create()
    const res = await call('GET', '/api/favorites/keys', { token: data!.key, client: 'claude-code' })
    expect(res.status).toBe(200)
    expect((await list())[0]).toMatchObject({ lastUsedClient: 'claude-code', lastUsedAt: new Date(Date.UTC(2026, 9, 23)).toISOString() })
    expect(repo.touches).toHaveLength(1)
  })

  it('格式不对、撤销后、过期后都拒绝', async () => {
    const { create, call, clock } = setup()
    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code
    expect(await code(await call('GET', '/api/favorites/keys', { token: 'mf_short' }))).toBe('invalid_api_key')
    const { data } = await create('30d', 30)
    const revoked = await create('gone')
    await call('DELETE', `/api/keys/${revoked.data!.item.id}`, { token: 'token-lina' })
    expect(await code(await call('GET', '/api/favorites/keys', { token: revoked.data!.key }))).toBe('invalid_api_key')
    clock.now += 30 * 86_400_000
    const expired = await call('GET', '/api/favorites/keys', { token: data!.key })
    expect(expired.status).toBe(401)
    expect(await code(expired)).toBe('api_key_expired')
  })

  it('每个密钥每分钟最多 60 次；最近使用 5 分钟内只写一次库，换客户端时立即写', async () => {
    const { create, call, clock, repo } = setup()
    const { data } = await create()
    for (let i = 0; i < 60; i++) expect((await call('GET', '/api/favorites/keys', { token: data!.key, client: 'codex' })).status).toBe(200)
    expect((await call('GET', '/api/favorites/keys', { token: data!.key, client: 'codex' })).status).toBe(429)
    expect(repo.touches).toHaveLength(1)
    clock.now += 61_000
    expect((await call('GET', '/api/favorites/keys', { token: data!.key, client: 'gemini-cli' })).status).toBe(200)
    expect(repo.touches.map((t) => t.client)).toEqual(['codex', 'gemini-cli'])
    clock.now += 5 * 60_000
    await call('GET', '/api/favorites/keys', { token: data!.key, client: 'gemini-cli' })
    expect(repo.touches).toHaveLength(3)
  })
})
