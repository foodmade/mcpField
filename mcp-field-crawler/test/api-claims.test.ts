import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { AuthUser, AuthVerifier } from '../src/api/auth/supabase-auth.ts'
import type { ClaimRepository, ClaimRow, ClaimTarget } from '../src/api/modules/claims/claim.repository.ts'
import { ClaimService, type ClaimStatus } from '../src/api/modules/claims/claim.service.ts'
import type { GithubOAuth, GithubRepo, GithubUser } from '../src/api/modules/claims/github-oauth.ts'
import type { Logger } from '../src/core/logger.ts'
import type { EntityKind } from '../src/core/types.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

/** 内存仓储：playwright-mcp 关联 microsoft/playwright-mcp，旧地址 playwright 指向它；local-only 没有仓库 */
class MemoryRepo implements ClaimRepository {
  rows = new Map<string, ClaimRow>()
  private targets: Record<string, ClaimTarget> = {
    'playwright-mcp': { slug: 'playwright-mcp', repository: { host: 'github.com', owner: 'microsoft', name: 'playwright-mcp' } },
    playwright: { slug: 'playwright-mcp', repository: { host: 'github.com', owner: 'microsoft', name: 'playwright-mcp' } },
    'local-only': { slug: 'local-only', repository: null },
  }
  async target(_kind: EntityKind, slug: string) {
    return this.targets[slug] ?? null
  }
  async find(kind: EntityKind, slug: string) {
    return this.rows.get(`${kind}:${slug}`) ?? null
  }
  async save(row: Omit<ClaimRow, 'revokedAt'>) {
    this.rows.set(`${row.kind}:${row.slug}`, { ...row, revokedAt: null })
  }
}

/** 假 GitHub：授权码 code-<login> 换到 token-<login>；仓库所有者是 ms（id 1），alice 是组织管理员 */
class FakeGithub implements GithubOAuth {
  users: Record<string, GithubUser> = {
    ms: { id: 1, login: 'ms', avatarUrl: null },
    alice: { id: 2, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/2' },
    bob: { id: 3, login: 'bob', avatarUrl: null },
  }
  revoked: string[] = []
  authorizeUrl(state: string) {
    return `https://github.com/login/oauth/authorize?state=${encodeURIComponent(state)}`
  }
  async exchange(code: string) {
    return code.startsWith('code-') ? `token-${code.slice(5)}` : null
  }
  async user(token: string) {
    return this.users[token.slice(6)]!
  }
  async repo(token: string): Promise<GithubRepo | null> {
    const login = token.slice(6)
    return { fullName: 'microsoft/playwright-mcp', ownerId: 1, permissions: login === 'alice' ? { admin: true } : { admin: false, maintain: false } }
  }
  async revoke(token: string) {
    this.revoked.push(token)
  }
}

const USERS: Record<string, AuthUser> = {
  'token-lina': { id: 'u-lina', name: 'lina-dev', avatar: null },
  'token-kenji': { id: 'u-kenji', name: 'kenji', avatar: null },
}
const fakeAuth: AuthVerifier = { verify: async (t) => USERS[t] ?? null }

function setup(github: FakeGithub | null = new FakeGithub()) {
  const repo = new MemoryRepo()
  const app = createApp({ entities: {}, claims: new ClaimService(repo, github, github ? 'secret' : null, silent), auth: fakeAuth, logger: silent, cookieSecure: true })
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(`/api/claims${path}`, {
      method,
      headers: {
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })

  /** 发起认领，返回 state 和浏览器拿到的 cookie */
  const start = async (token: string, slug = 'playwright-mcp', returnTo = '/zh/servers/playwright-mcp?tab=1') => {
    const res = await call('POST', `/servers/${slug}/start`, { token, body: { returnTo } })
    expect(res.status).toBe(200)
    const { url } = ((await res.json()) as { data: { url: string } }).data
    const setCookie = res.headers.get('set-cookie') ?? ''
    return { state: new URL(url).searchParams.get('state')!, cookie: setCookie.split(';')[0]!, setCookie }
  }
  /** GitHub 跳回，返回 Location */
  const callback = async (q: Record<string, string>, cookie?: string) => {
    const res = await call('GET', `/github/callback?${new URLSearchParams(q)}`, { cookie })
    expect(res.status).toBe(302)
    return res.headers.get('location')
  }
  const status = async (slug = 'playwright-mcp', token?: string) => ((await (await call('GET', `/servers/${slug}`, { token })).json()) as { data: ClaimStatus }).data
  return { repo, github, call, start, callback, status }
}

describe('认领接口', () => {
  it('仓库所有者一键认领：跳回原页面带 claim=ok，令牌用完吊销，之后显示已认领', async () => {
    const { start, callback, status, github, repo } = setup()
    expect(await status()).toEqual({ claimable: true, claim: null, mine: false })

    const { state, cookie, setCookie } = await start('token-lina')
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    expect(setCookie).toMatch(/SameSite=Lax/)
    expect(setCookie).toMatch(/Path=\/api\/claims/)
    expect(await callback({ code: 'code-ms', state }, cookie)).toBe('/zh/servers/playwright-mcp?tab=1&claim=ok')
    expect(github!.revoked).toEqual(['token-ms'])
    expect(repo.rows.get('server:playwright-mcp')).toMatchObject({ userId: 'u-lina', userName: 'lina-dev', githubLogin: 'ms', method: 'owner' })

    expect(await status('playwright-mcp', 'token-lina')).toMatchObject({ claim: { login: 'ms', method: 'owner' }, mine: true })
    // 旧地址查到的是同一个条目
    expect(await status('playwright', 'token-kenji')).toMatchObject({ claim: { login: 'ms' }, mine: false })
  })

  it('组织仓库的管理员可以认领，普通用户被拒绝', async () => {
    const { start, callback, repo } = setup()
    let s = await start('token-lina')
    expect(await callback({ code: 'code-bob', state: s.state }, s.cookie)).toMatch(/claim=denied$/)
    expect(repo.rows.size).toBe(0)
    s = await start('token-lina')
    expect(await callback({ code: 'code-alice', state: s.state }, s.cookie)).toMatch(/claim=ok$/)
    expect(repo.rows.get('server:playwright-mcp')).toMatchObject({ githubLogin: 'alice', method: 'maintainer' })
  })

  it('已被别人认领时不能发起，也不能在回调里抢', async () => {
    const { start, callback, call } = setup()
    const first = await start('token-lina')
    // kenji 在 lina 认领完成前发起
    const second = await start('token-kenji')
    expect(await callback({ code: 'code-ms', state: first.state }, first.cookie)).toMatch(/claim=ok$/)
    expect(await callback({ code: 'code-alice', state: second.state }, second.cookie)).toMatch(/claim=taken$/)
    expect((await call('POST', '/servers/playwright-mcp/start', { token: 'token-kenji', body: {} })).status).toBe(409)
  })

  it('被撤销后同一个 GitHub 账号不能再认领，换人可以', async () => {
    const { start, callback, repo, status } = setup()
    let s = await start('token-lina')
    await callback({ code: 'code-ms', state: s.state }, s.cookie)
    repo.rows.get('server:playwright-mcp')!.revokedAt = new Date()
    expect((await status()).claim).toBeNull()

    s = await start('token-lina')
    expect(await callback({ code: 'code-ms', state: s.state }, s.cookie)).toMatch(/claim=revoked$/)
    s = await start('token-kenji')
    expect(await callback({ code: 'code-alice', state: s.state }, s.cookie)).toMatch(/claim=ok$/)
    expect(repo.rows.get('server:playwright-mcp')).toMatchObject({ userId: 'u-kenji', githubLogin: 'alice', revokedAt: null })
  })

  it('cookie 对不上（别人发来的授权链接）、state 被改、授权码无效时都不写入', async () => {
    const { start, callback, repo } = setup()
    const s = await start('token-lina')
    expect(await callback({ code: 'code-ms', state: s.state })).toMatch(/claim=expired$/)
    expect(await callback({ code: 'code-ms', state: s.state }, 'mf_claim=other')).toMatch(/claim=expired$/)
    expect(await callback({ code: 'code-ms', state: `${s.state}x` }, s.cookie)).toBe('/servers?claim=expired')
    expect(await callback({ code: 'bad', state: s.state }, s.cookie)).toMatch(/claim=expired$/)
    expect(await callback({ error: 'access_denied', state: s.state }, s.cookie)).toMatch(/claim=cancelled$/)
    expect(repo.rows.size).toBe(0)
  })

  it('需要登录；没有仓库的服务不能认领；returnTo 只接受站内路径', async () => {
    const { call, start, callback, status } = setup()
    expect((await call('POST', '/servers/playwright-mcp/start', { body: {} })).status).toBe(401)
    expect((await call('POST', '/servers/local-only/start', { token: 'token-lina', body: {} })).status).toBe(400)
    expect((await call('POST', '/servers/nope/start', { token: 'token-lina', body: {} })).status).toBe(404)
    expect(await status('local-only')).toEqual({ claimable: false, claim: null, mine: false })
    const s = await start('token-lina', 'playwright-mcp', '//evil.example.com/x')
    expect(await callback({ code: 'code-ms', state: s.state }, s.cookie)).toBe('/servers/playwright-mcp?claim=ok')
  })

  it('没有配置 GitHub 应用时只能查状态', async () => {
    const { call, status } = setup(null)
    expect(await status()).toMatchObject({ claimable: true, claim: null })
    expect((await call('POST', '/servers/playwright-mcp/start', { token: 'token-lina', body: {} })).status).toBe(503)
  })
})
