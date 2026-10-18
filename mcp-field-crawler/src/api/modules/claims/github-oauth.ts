/*
 * 认领用的 GitHub OAuth App（与 Supabase 登录用的 GitHub 应用分开）。
 * 不申请任何 scope：只读公开信息，授权页最简单；用户授权过一次后，再次认领时 GitHub 不再弹授权页，直接跳回。
 * 拿到的令牌只在回调里用一次，用完立即吊销，不保存。
 */

export interface GithubUser {
  id: number
  login: string
  avatarUrl: string | null
}

export interface GithubRepo {
  /** owner/name：仓库改过名时是新名字 */
  fullName: string
  ownerId: number
  /** 当前授权用户对这个仓库的权限；拿不到时为 null */
  permissions: { admin?: boolean; maintain?: boolean } | null
}

export interface GithubOAuth {
  authorizeUrl(state: string): string
  /** 用授权码换令牌；授权码无效或过期时返回 null */
  exchange(code: string): Promise<string | null>
  user(token: string): Promise<GithubUser>
  /** 仓库不存在或看不到时返回 null */
  repo(token: string, owner: string, name: string): Promise<GithubRepo | null>
  revoke(token: string): Promise<void>
}

export interface GithubOAuthConfig {
  clientId: string
  clientSecret: string
  callbackUrl: string
}

const API = 'https://api.github.com'
const TIMEOUT = 10_000

export class GithubOAuthApp implements GithubOAuth {
  constructor(
    private readonly config: GithubOAuthConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private headers(token: string) {
    return { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'mcpfield-claim' }
  }

  authorizeUrl(state: string): string {
    const qs = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.callbackUrl, state, allow_signup: 'false' })
    return `https://github.com/login/oauth/authorize?${qs}`
  }

  async exchange(code: string): Promise<string | null> {
    const res = await this.fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'mcpfield-claim' },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code, redirect_uri: this.config.callbackUrl }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) throw new Error(`GitHub 换取令牌失败：HTTP ${res.status}`)
    const body = (await res.json()) as { access_token?: string; error?: string }
    // 授权码过期、已用过时 GitHub 返回 200 + error=bad_verification_code
    if (body.error === 'bad_verification_code') return null
    if (!body.access_token) throw new Error(`GitHub 换取令牌失败：${body.error ?? '没有返回令牌'}`)
    return body.access_token
  }

  async user(token: string): Promise<GithubUser> {
    const res = await this.fetchFn(`${API}/user`, { headers: this.headers(token), signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) throw new Error(`读取 GitHub 用户失败：HTTP ${res.status}`)
    const body = (await res.json()) as { id: number; login: string; avatar_url?: string }
    return { id: body.id, login: body.login, avatarUrl: body.avatar_url ?? null }
  }

  async repo(token: string, owner: string, name: string): Promise<GithubRepo | null> {
    const res = await this.fetchFn(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { headers: this.headers(token), signal: AbortSignal.timeout(TIMEOUT) })
    if (res.status === 404 || res.status === 403) return null
    if (!res.ok) throw new Error(`读取 GitHub 仓库失败：HTTP ${res.status}`)
    const body = (await res.json()) as { full_name: string; owner: { id: number }; permissions?: { admin?: boolean; maintain?: boolean } }
    return { fullName: body.full_name, ownerId: body.owner.id, permissions: body.permissions ?? null }
  }

  async revoke(token: string): Promise<void> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')
    await this.fetchFn(`${API}/applications/${this.config.clientId}/token`, {
      method: 'DELETE',
      headers: { accept: 'application/vnd.github+json', authorization: `Basic ${basic}`, 'content-type': 'application/json', 'user-agent': 'mcpfield-claim' },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
  }
}
