import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import { SupabaseAuth, userFromClaims, type AuthUser, type AuthVerifier } from '../src/api/auth/supabase-auth.ts'
import type { CommentRepository, CommentRow, CommentSort, NewComment, Reaction } from '../src/api/modules/comments/comment.repository.ts'
import { CommentService, type CommentDto, type CommentPage } from '../src/api/modules/comments/comment.service.ts'
import type { Logger } from '../src/core/logger.ts'
import type { EntityKind } from '../src/core/types.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

/** 内存仓储：slug 表里有 cli:glab，旧地址 cli:gitlab-cli 指向它 */
class MemoryRepo implements CommentRepository {
  rows: CommentRow[] = []
  reactions: { commentId: number; userId: string; reaction: Reaction }[] = []
  private slugs: Record<string, string> = { 'cli:glab': 'glab', 'cli:gitlab-cli': 'glab' }
  private seq = 0
  clock = 0

  async resolveSlug(kind: EntityKind, slug: string) {
    return this.slugs[`${kind}:${slug}`] ?? null
  }
  async page(kind: EntityKind, slug: string, sort: CommentSort, offset: number, limit: number) {
    const all = this.rows.filter((r) => r.kind === kind && r.slug === slug)
    const score = (r: CommentRow) => this.reactions.filter((x) => x.commentId === r.id).length + all.filter((x) => x.parentId === r.id).length
    const top = all.filter((r) => r.parentId === null)
    top.sort((a, b) => (sort === 'oldest' ? a.id - b.id : sort === 'top' ? score(b) - score(a) || b.id - a.id : b.id - a.id))
    return { rows: top.slice(offset, offset + limit), total: top.length, count: all.length }
  }
  async replies(ids: number[]) {
    return this.rows.filter((r) => r.parentId !== null && ids.includes(r.parentId))
  }
  async reactionCounts(ids: number[]) {
    const m = new Map<string, { commentId: number; reaction: Reaction; n: number }>()
    for (const r of this.reactions.filter((x) => ids.includes(x.commentId))) {
      const k = `${r.commentId}:${r.reaction}`
      m.set(k, { commentId: r.commentId, reaction: r.reaction, n: (m.get(k)?.n ?? 0) + 1 })
    }
    return [...m.values()]
  }
  async reactionsBy(ids: number[], userId: string) {
    return this.reactions.filter((x) => ids.includes(x.commentId) && x.userId === userId)
  }
  async find(id: number) {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async insert(row: NewComment) {
    const r = { ...row, id: ++this.seq, createdAt: new Date(this.clock) }
    this.rows.push(r)
    return r
  }
  async remove(id: number) {
    this.rows = this.rows.filter((r) => r.id !== id && r.parentId !== id)
  }
  async postedSince(userId: string, since: Date) {
    return this.rows.filter((r) => r.userId === userId && r.createdAt >= since).length
  }
  async setReaction(commentId: number, userId: string, reaction: Reaction, on: boolean) {
    this.reactions = this.reactions.filter((x) => !(x.commentId === commentId && x.userId === userId && x.reaction === reaction))
    if (on) this.reactions.push({ commentId, userId, reaction })
  }
}

const USERS: Record<string, AuthUser> = {
  'token-lina': { id: 'u-lina', name: 'lina-dev', avatar: null },
  'token-kenji': { id: 'u-kenji', name: 'kenji', avatar: 'https://example.com/k.png' },
}
const dto = async (r: Response | Promise<Response>) => ((await (await r).json()) as { data: CommentDto }).data
const pageOf = async (r: Response | Promise<Response>) => (await (await r).json()) as CommentPage
const reactionsOf = async (r: Response | Promise<Response>) => ((await (await r).json()) as { data: Pick<CommentDto, 'reactions' | 'mine'> }).data

const fakeAuth: AuthVerifier = { verify: async (t) => USERS[t] ?? null }

function setup(auth: AuthVerifier | null = fakeAuth) {
  const repo = new MemoryRepo()
  const app = createApp({ entities: {}, comments: new CommentService(repo, () => repo.clock), auth: auth ?? undefined, logger: silent })
  const call = (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
    app.request(`/api/comments${path}`, {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  return { repo, call }
}

describe('评论接口', () => {
  it('发表、回复、列表：回复挂在顶层评论下，旧地址也算同一个条目', async () => {
    const { call } = setup()
    const first = await call('POST', '/cli/glab', { token: 'token-lina', body: { body: '  用 `glab mr create --fill`  ' } })
    expect(first.status).toBe(201)
    const created = await dto(first)
    expect(created).toMatchObject({ author: 'lina-dev', body: '用 `glab mr create --fill`', own: true, replies: [] })

    const reply = await call('POST', '/cli/gitlab-cli', { token: 'token-kenji', body: { body: '感谢', parentId: Number(created.id) } })
    expect(reply.status).toBe(201)
    // 回复别人的回复，仍挂到顶层评论下
    const nested = await call('POST', '/cli/glab', { token: 'token-lina', body: { body: '+1', parentId: Number((await dto(reply)).id) } })
    expect(nested.status).toBe(201)

    const res = await call('GET', '/cli/glab', { token: 'token-kenji' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const page = await pageOf(res)
    expect(page.meta).toMatchObject({ total: 1, count: 3, page: 1 })
    expect(page.data[0]!.own).toBe(false)
    expect(page.data[0]!.replies!.map((r) => [r.body, r.own])).toEqual([['感谢', true], ['+1', false]])
  })

  it('未登录不能发表，条目不存在返回 404，空内容返回 400', async () => {
    const { call } = setup()
    expect((await call('POST', '/cli/glab', { body: { body: 'hi' } })).status).toBe(401)
    expect((await call('POST', '/cli/glab', { token: 'bad', body: { body: 'hi' } })).status).toBe(401)
    expect((await call('POST', '/cli/nope', { token: 'token-lina', body: { body: 'hi' } })).status).toBe(404)
    expect((await call('POST', '/widget/glab', { token: 'token-lina', body: { body: 'hi' } })).status).toBe(404)
    expect((await call('POST', '/cli/glab', { token: 'token-lina', body: { body: '   ' } })).status).toBe(400)
    expect((await call('GET', '/cli/nope')).status).toBe(404)
  })

  it('没有配置登录校验时只能读', async () => {
    const { call } = setup(null)
    expect((await call('GET', '/cli/glab')).status).toBe(200)
    expect((await call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'hi' } })).status).toBe(503)
  })

  it('只能删除自己的评论，删除顶层评论时回复一起删除', async () => {
    const { call, repo } = setup()
    const id = (await dto(call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'a' } }))).id
    await call('POST', '/cli/glab', { token: 'token-kenji', body: { body: 'b', parentId: Number(id) } })
    expect((await call('DELETE', `/${id}`, { token: 'token-kenji' })).status).toBe(403)
    expect((await call('DELETE', `/${id}`, { token: 'token-lina' })).status).toBe(204)
    expect(repo.rows).toEqual([])
    expect((await call('DELETE', `/${id}`, { token: 'token-lina' })).status).toBe(404)
  })

  it('回应：添加、重复添加不重复计数、取消；最热排序按回应和回复数', async () => {
    const { call } = setup()
    const a = (await dto(call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'a' } }))).id
    const b = (await dto(call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'b' } }))).id
    await call('PUT', `/${a}/reactions/up`, { token: 'token-kenji' })
    const twice = await reactionsOf(call('PUT', `/${a}/reactions/up`, { token: 'token-kenji' }))
    expect(twice).toEqual({ reactions: { up: 1 }, mine: ['up'] })
    expect((await call('PUT', `/${a}/reactions/angry`, { token: 'token-kenji' })).status).toBe(400)

    const top = await pageOf(call('GET', '/cli/glab?sort=top'))
    expect(top.data.map((c) => c.id)).toEqual([a, b])
    const newest = await pageOf(call('GET', '/cli/glab'))
    expect(newest.data.map((c) => c.id)).toEqual([b, a])

    const off = await reactionsOf(call('DELETE', `/${a}/reactions/up`, { token: 'token-kenji' }))
    expect(off).toEqual({ reactions: {}, mine: [] })
  })

  it('限流：10 分钟内最多 10 条', async () => {
    const { call, repo } = setup()
    for (let i = 0; i < 10; i++) expect((await call('POST', '/cli/glab', { token: 'token-lina', body: { body: `#${i}` } })).status).toBe(201)
    expect((await call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'more' } })).status).toBe(429)
    repo.clock += 11 * 60_000
    expect((await call('POST', '/cli/glab', { token: 'token-lina', body: { body: 'later' } })).status).toBe(201)
  })
})

describe('SupabaseAuth', () => {
  const url = 'https://demo.supabase.co'
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256' }
  const now = 1_800_000_000_000
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const token = (claims: object, kid = 'k1') => {
    const head = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64(claims)}`
    return `${head}.${sign('sha256', Buffer.from(head), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const good = { sub: 'abcdef12-0000', aud: 'authenticated', role: 'authenticated', iss: `${url}/auth/v1`, exp: now / 1000 + 600, user_metadata: { user_name: 'lina-dev', avatar_url: 'https://avatars.githubusercontent.com/u/1' } }

  it('验签通过时返回用户；过期、签发方不对、签名被改都拒绝', async () => {
    let fetches = 0
    const auth = new SupabaseAuth(url, async () => (fetches++, { keys: [jwk] }), () => now)
    expect(await auth.verify(token(good))).toEqual({ id: 'abcdef12-0000', name: 'lina-dev', avatar: 'https://avatars.githubusercontent.com/u/1' })
    expect(await auth.verify(token({ ...good, exp: now / 1000 - 1 }))).toBeNull()
    expect(await auth.verify(token({ ...good, iss: 'https://evil.supabase.co/auth/v1' }))).toBeNull()
    expect(await auth.verify(token({ ...good, role: 'anon', aud: 'anon' }))).toBeNull()
    const t = token(good)
    expect(await auth.verify(`${t.slice(0, t.lastIndexOf('.'))}.${b64({ x: 1 })}`)).toBeNull()
    expect(await auth.verify('not-a-jwt')).toBeNull()
    expect(fetches).toBe(1)
  })

  it('邮箱登录不公开邮箱，头像只接受 https', () => {
    expect(userFromClaims({ sub: 'abcdef12-3456', user_metadata: { email: 'li@x.com', avatar_url: 'http://x/a.png' } })).toEqual({ id: 'abcdef12-3456', name: 'user-abcdef', avatar: null })
  })
})
