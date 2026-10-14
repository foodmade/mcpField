import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto'

/** 登录用户：从 Supabase 的访问令牌里取，昵称和头像随评论保存 */
export interface AuthUser {
  id: string
  name: string
  avatar: string | null
}

/** 校验请求带的访问令牌；无效或过期时返回 null */
export interface AuthVerifier {
  verify(token: string): Promise<AuthUser | null>
}

type Jwk = JsonWebKey & { kid?: string; alg?: string }
type Claims = { sub?: string; aud?: string | string[]; iss?: string; exp?: number; role?: string; user_metadata?: Record<string, unknown> }

/** 公钥列表最长缓存时间；遇到没见过的 kid（密钥轮换）时立即重新读取，但两次之间至少隔 1 分钟 */
const KEYS_TTL = 10 * 60_000
const REFETCH_GAP = 60_000

const b64url = (s: string) => Buffer.from(s, 'base64url')
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** 显示名：GitHub 优先用账号名（与 GitHub 上一致），其次全名；邮箱登录不公开邮箱，用 user- 加 ID 前几位 */
export function userFromClaims(claims: Claims): AuthUser | null {
  if (!claims.sub) return null
  const meta = claims.user_metadata ?? {}
  const name = str(meta.user_name, 100) ?? str(meta.preferred_username, 100) ?? str(meta.full_name, 100) ?? str(meta.name, 100) ?? `user-${claims.sub.slice(0, 6)}`
  const avatar = str(meta.avatar_url, 512) ?? str(meta.picture, 512)
  return { id: claims.sub, name, avatar: avatar?.startsWith('https://') ? avatar : null }
}

/**
 * Supabase Auth 令牌校验：用项目公开的 JWKS（非对称签名，ES256 / RS256）在本地验签，不需要密钥，也不用每次请求 Supabase。
 * 校验签名、签发方、受众（authenticated）和过期时间。
 */
export class SupabaseAuth implements AuthVerifier {
  private keys = new Map<string, { key: KeyObject; alg: string }>()
  private fetchedAt = 0

  constructor(
    private readonly supabaseUrl: string,
    private readonly fetchJwks: (url: string) => Promise<{ keys: Jwk[] }> = async (url) => (await fetch(url, { signal: AbortSignal.timeout(5000) })).json() as Promise<{ keys: Jwk[] }>,
    private readonly now: () => number = Date.now,
  ) {}

  private get issuer() {
    return `${this.supabaseUrl.replace(/\/$/, '')}/auth/v1`
  }

  private async load(force: boolean) {
    const age = this.now() - this.fetchedAt
    if (!(age > KEYS_TTL || (force && age > REFETCH_GAP))) return
    this.fetchedAt = this.now()
    const { keys } = await this.fetchJwks(`${this.issuer}/.well-known/jwks.json`)
    this.keys = new Map(keys.filter((k) => k.kid && k.alg).map((k) => [k.kid!, { key: createPublicKey({ key: k, format: 'jwk' }), alg: k.alg! }]))
  }

  private async keyFor(kid: string) {
    await this.load(false).catch(() => undefined)
    if (!this.keys.has(kid)) await this.load(true).catch(() => undefined)
    return this.keys.get(kid)
  }

  async verify(token: string): Promise<AuthUser | null> {
    const parts = token.split('.')
    const [head, payload, signature] = parts
    if (parts.length !== 3 || !head || !payload || !signature) return null
    let header: { alg?: string; kid?: string }
    let claims: Claims
    try {
      header = JSON.parse(b64url(head).toString('utf8'))
      claims = JSON.parse(b64url(payload).toString('utf8'))
    } catch {
      return null
    }
    if (!header.kid || (header.alg !== 'ES256' && header.alg !== 'RS256')) return null
    const jwk = await this.keyFor(header.kid)
    if (!jwk || jwk.alg !== header.alg) return null
    const signed = Buffer.from(`${head}.${payload}`)
    const ok = verify('sha256', signed, header.alg === 'ES256' ? { key: jwk.key, dsaEncoding: 'ieee-p1363' } : jwk.key, b64url(signature))
    if (!ok) return null
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (claims.iss !== this.issuer || !aud.includes('authenticated') || claims.role !== 'authenticated') return null
    if (!claims.exp || claims.exp * 1000 <= this.now()) return null
    return userFromClaims(claims)
  }
}
