import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { AuthUser, AuthVerifier } from '../src/api/auth/supabase-auth.ts'
import type { EntityListItem } from '../src/api/modules/entities/entity.dto.ts'
import type { FavoriteRepository, FavoriteRow, ResolvedEntity } from '../src/api/modules/favorites/favorite.repository.ts'
import { FAVORITES_MAX, FavoriteService, type FavoriteDto } from '../src/api/modules/favorites/favorite.service.ts'
import type { Logger } from '../src/core/logger.ts'
import type { EntityKind } from '../src/core/types.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

/**
 * 内存仓储：地址表里 server:playwright 的旧地址 server:playwright-old 指向它，skill:pdf 是 Skill，
 * client:cursor 是不支持收藏的类型。delisted 里的条目视为已下架（地址表里没有了）。
 */
class MemoryRepo implements FavoriteRepository {
  rows: (FavoriteRow & { userId: string; id: number })[] = []
  private seq = 0
  slugs: Record<string, ResolvedEntity> = {
    'server:playwright': { slug: 'playwright', name: 'Playwright MCP' },
    'server:playwright-old': { slug: 'playwright', name: 'Playwright MCP' },
    'server:github': { slug: 'github', name: 'GitHub' },
    'skill:pdf': { slug: 'pdf', name: 'pdf' },
    'client:cursor': { slug: 'cursor', name: 'Cursor' },
  }

  async resolve(kind: EntityKind, slugs: string[]) {
    return new Map(slugs.flatMap((s) => (this.slugs[`${kind}:${s}`] ? [[s, this.slugs[`${kind}:${s}`]!] as const] : [])))
  }
  async list(userId: string, limit: number) {
    return this.rows
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r, canonical: this.slugs[`${r.kind}:${r.slug}`]?.slug ?? null }))
      .sort((a, b) => b.favoritedAt.getTime() - a.favoritedAt.getTime() || b.id - a.id)
      .slice(0, limit)
  }
  async count(userId: string) {
    return this.rows.filter((r) => r.userId === userId).length
  }
  async add(userId: string, kind: EntityKind, entity: ResolvedEntity, favoritedAt: Date) {
    if (this.rows.some((r) => r.userId === userId && r.kind === kind && r.slug === entity.slug)) return
    this.rows.push({ id: ++this.seq, userId, kind, slug: entity.slug, canonical: null, name: entity.name, favoritedAt })
  }
  async remove(userId: string, kind: EntityKind, slug: string) {
    const canonical = this.slugs[`${kind}:${slug}`]?.slug
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.kind === kind && (r.slug === slug || this.slugs[`${kind}:${r.slug}`]?.slug === canonical)))
  }
  /** 直接写一行（模拟收藏之后条目被合并、下架） */
  seed(userId: string, kind: EntityKind, slug: string, name: string, at: number) {
    this.rows.push({ id: ++this.seq, userId, kind, slug, canonical: null, name, favoritedAt: new Date(at) })
  }
}

const USERS: Record<string, AuthUser> = {
  'token-lina': { id: 'u-lina', name: 'lina-dev', avatar: null },
  'token-kenji': { id: 'u-kenji', name: 'kenji', avatar: null },
}
const fakeAuth: AuthVerifier = { verify: async (t) => USERS[t] ?? null }

const item = (kind: EntityKind, slug: string, name: string) => ({ kind, slug, name, tagline: `${name} (${'zh'})` }) as unknown as EntityListItem

function setup(auth: AuthVerifier | null = fakeAuth) {
  const repo = new MemoryRepo()
  const clock = { now: 1_000_000 }
  const calls: { kind: string; slugs: string[]; locale: string }[] = []
  const service = new FavoriteService(
    repo,
    async (kind, slugs, locale) => {
      calls.push({ kind, slugs, locale })
      return slugs.flatMap((s) => (Object.values(repo.slugs).some((e) => e.slug === s) ? [item(kind, s, repo.slugs[`${kind}:${s}`]?.name ?? s)] : []))
    },
    () => clock.now,
  )
  const app = createApp({ entities: {}, favorites: service, auth: auth ?? undefined, logger: silent })
  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    app.request(`/api/favorites${path}`, {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  const keys = async (token = 'token-lina') => ((await (await call('GET', '/keys', { token })).json()) as { data: string[] }).data
  const list = async (token = 'token-lina', locale = 'zh') => ((await (await call('GET', `?locale=${locale}`, { token })).json()) as { data: FavoriteDto[] }).data
  return { repo, clock, calls, call, keys, list }
}

describe('收藏接口', () => {
  it('都需要登录：没带令牌 401，没配置登录服务 503；响应不让缓存', async () => {
    const { call } = setup()
    const res = await call('GET', '/keys')
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect((await call('PUT', '/server/playwright', { token: 'bad' })).status).toBe(401)
    expect((await setup(null).call('GET', '/keys', { token: 'token-lina' })).status).toBe(503)
  })

  it('收藏后出现在标识和列表里，列表带目录列表项并按请求语言取', async () => {
    const { call, keys, list, calls } = setup()
    const res = await call('PUT', '/server/playwright', { token: 'token-lina' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: unknown }).data).toEqual({ key: 'server:playwright', favoritedAt: new Date(1_000_000).toISOString() })
    expect(await keys()).toEqual(['server:playwright'])
    const data = await list()
    expect(data).toEqual([{ kind: 'server', slug: 'playwright', name: 'Playwright MCP', favoritedAt: new Date(1_000_000).toISOString(), item: expect.objectContaining({ slug: 'playwright' }) }])
    expect(calls).toEqual([{ kind: 'server', slugs: ['playwright'], locale: 'zh' }])
  })

  it('用旧地址收藏时存正式地址；重复收藏不改收藏时间', async () => {
    const { call, keys, list, clock } = setup()
    const res = await call('PUT', '/server/playwright-old', { token: 'token-lina' })
    expect(((await res.json()) as { data: { key: string } }).data.key).toBe('server:playwright')
    clock.now += 5000
    await call('PUT', '/server/playwright', { token: 'token-lina' })
    expect(await keys()).toEqual(['server:playwright'])
    expect((await list())[0]!.favoritedAt).toBe(new Date(1_000_000).toISOString())
  })

  it('不支持的类型 400，不存在的条目 404', async () => {
    const { call } = setup()
    const unsupported = await call('PUT', '/client/cursor', { token: 'token-lina' })
    expect(unsupported.status).toBe(400)
    expect(((await unsupported.json()) as { error: { code: string } }).error.code).toBe('unsupported_kind')
    expect((await call('PUT', '/server/nope', { token: 'token-lina' })).status).toBe(404)
    expect((await call('PUT', '/server/playwright', { token: 'token-lina', body: { favoritedAt: 'yesterday' } })).status).toBe(400)
  })

  it('撤销取消收藏时恢复原来的收藏时间；晚于现在的时间不接受，按现在算', async () => {
    const { call, list, clock } = setup()
    clock.now = 2_000_000
    await call('PUT', '/skill/pdf', { token: 'token-lina', body: { favoritedAt: new Date(1_500_000).toISOString() } })
    await call('PUT', '/server/github', { token: 'token-lina', body: { favoritedAt: new Date(9_000_000).toISOString() } })
    expect((await list()).map((f) => [f.slug, f.favoritedAt])).toEqual([
      ['github', new Date(2_000_000).toISOString()],
      ['pdf', new Date(1_500_000).toISOString()],
    ])
  })

  it('取消收藏：同一条目用旧地址存下的也一起删掉；只影响自己的', async () => {
    const { call, keys, repo } = setup()
    repo.seed('u-lina', 'server', 'playwright-old', 'Playwright MCP', 1)
    await call('PUT', '/server/playwright', { token: 'token-kenji' })
    const res = await call('DELETE', '/server/playwright', { token: 'token-lina' })
    expect(res.status).toBe(204)
    expect(await keys()).toEqual([])
    expect(await keys('token-kenji')).toEqual(['server:playwright'])
  })

  it('条目被合并后同一条目只出现一次；已下架的保留，用收藏时的名称，item 为 null', async () => {
    const { list, keys, repo } = setup()
    repo.seed('u-lina', 'server', 'playwright-old', 'Playwright (old)', 3)
    repo.seed('u-lina', 'server', 'playwright', 'Playwright MCP', 2)
    repo.seed('u-lina', 'server', 'sequential-thinking', 'Sequential Thinking', 1)
    expect(await keys()).toEqual(['server:playwright', 'server:sequential-thinking'])
    const data = await list()
    expect(data.map((f) => [f.slug, f.name, f.item === null])).toEqual([
      ['playwright', 'Playwright MCP', false],
      ['sequential-thinking', 'Sequential Thinking', true],
    ])
  })

  it('并入浏览器本地的收藏：保持先后顺序，跳过不支持的类型、已下架和已收藏的', async () => {
    const { call, list, clock } = setup()
    await call('PUT', '/server/github', { token: 'token-lina' })
    clock.now += 10_000
    const res = await call('POST', '/import', { token: 'token-lina', body: { keys: ['skill:pdf', 'client:cursor', 'server:gone', 'server:github', 'server:playwright-old', 'junk'] } })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: string[] }).data).toEqual(['server:playwright', 'skill:pdf', 'server:github'])
    expect((await list())[2]!.favoritedAt).toBe(new Date(1_000_000).toISOString())
  })

  it('并入时不超过收藏上限；超出单次上限的请求 400', async () => {
    const { call, keys, repo } = setup()
    for (let i = 0; i < FAVORITES_MAX - 1; i++) repo.seed('u-lina', 'server', `x-${i}`, `x-${i}`, i)
    await call('POST', '/import', { token: 'token-lina', body: { keys: ['server:playwright', 'skill:pdf'] } })
    expect((await keys()).filter((k) => !k.startsWith('server:x-'))).toEqual(['server:playwright'])
    const full = await call('PUT', '/server/github', { token: 'token-lina' })
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe('limit_reached')
    expect((await call('POST', '/import', { token: 'token-lina', body: { keys: Array.from({ length: 201 }, (_, i) => `server:${i}`) } })).status).toBe(400)
  })
})
