import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Logger } from '../../../core/logger.ts'
import type { EntityKind } from '../../../core/types.ts'
import type { AuthUser } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import type { ClaimRepository } from './claim.repository.ts'
import type { GithubOAuth } from './github-oauth.ts'

/** 只有 MCP 服务可以认领 */
const KIND: EntityKind = 'server'
/** 从点击认领到 GitHub 跳回的最长时间 */
const STATE_TTL = 10 * 60_000

/** 回到详情页时带的结果（?claim=） */
export type ClaimResult = 'ok' | 'cancelled' | 'expired' | 'denied' | 'taken' | 'revoked' | 'error'

export interface ClaimStatus {
  /** 关联了 GitHub 仓库，可以认领 */
  claimable: boolean
  claim: { login: string; avatar: string | null; method: 'owner' | 'maintainer'; claimedAt: string } | null
  /** 当前登录用户认领的 */
  mine: boolean
}

/** 签在 state 里、跳转 GitHub 往返时带着的信息 */
interface StatePayload {
  /** 网站账号 ID、昵称 */
  u: string
  n: string
  /** 条目的正式 slug */
  s: string
  /** 完成后回到的站内地址 */
  r: string
  /** 与浏览器 cookie 里的随机数对应：防止别人把自己发起的授权链接发给仓库主人点 */
  c: string
  /** 过期时间（毫秒） */
  x: number
}

const b64 = (buf: Buffer) => buf.toString('base64url')

/** 站内路径才接受，避免被拼成跳到外站的链接 */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.length > 512) return null
  return value
}

/**
 * 认领流程：start 生成 GitHub 授权地址，GitHub 跳回后 complete 用授权码验证仓库归属并写入。
 * 判定：个人仓库的所有者（按 GitHub 账号 ID 比较，改用户名不影响），或组织仓库的管理员 / 维护者。
 * 已被别人认领的不能抢；被管理员撤销过的同一个 GitHub 账号不能再认领。
 */
export class ClaimService {
  private readonly key: Buffer | null

  constructor(
    private readonly repository: ClaimRepository,
    private readonly github: GithubOAuth | null,
    /** 签 state 的密钥来源（GitHub 应用的 Client Secret）；没配置 GitHub 应用时为空 */
    secret: string | null,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.key = secret ? createHash('sha256').update(`mcpfield-claim-state:${secret}`).digest() : null
  }

  get enabled(): boolean {
    return !!(this.github && this.key)
  }

  private sign(payload: StatePayload): string {
    const body = b64(Buffer.from(JSON.stringify(payload)))
    return `${body}.${b64(createHmac('sha256', this.key!).update(body).digest())}`
  }

  private verify(state: string): StatePayload | null {
    const [body, mac] = state.split('.')
    if (!body || !mac || !this.key) return null
    const expected = createHmac('sha256', this.key).update(body).digest()
    const given = Buffer.from(mac, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
    } catch {
      return null
    }
  }

  private async targetOf(slug: string) {
    const target = await this.repository.target(KIND, slug)
    if (!target) throw ApiError.notFound(`MCP 服务 "${slug}" 不存在`)
    return target
  }

  async status(slug: string, viewer: AuthUser | null): Promise<ClaimStatus> {
    const target = await this.targetOf(slug)
    const row = await this.repository.find(KIND, target.slug)
    const active = row && !row.revokedAt ? row : null
    return {
      claimable: target.repository?.host === 'github.com',
      claim: active && { login: active.githubLogin, avatar: active.githubAvatar, method: active.method, claimedAt: active.claimedAt.toISOString() },
      mine: !!active && active.userId === viewer?.id,
    }
  }

  /** 发起认领：返回 GitHub 授权地址和要写进 cookie 的随机数 */
  async start(slug: string, user: AuthUser, returnTo: string): Promise<{ url: string; nonce: string }> {
    if (!this.enabled) throw new ApiError(503, 'claim_unavailable', '认领功能暂未开放')
    const target = await this.targetOf(slug)
    if (target.repository?.host !== 'github.com') throw new ApiError(400, 'not_claimable', '这个服务没有关联 GitHub 仓库，暂不支持认领')
    const row = await this.repository.find(KIND, target.slug)
    if (row && !row.revokedAt && row.userId !== user.id) throw new ApiError(409, 'taken', '这个服务已经被认领')
    const nonce = b64(randomBytes(16))
    const state = this.sign({ u: user.id, n: user.name, s: target.slug, r: returnTo, c: nonce, x: this.now() + STATE_TTL })
    return { url: this.github!.authorizeUrl(state), nonce }
  }

  /** GitHub 跳回：验证并写入，返回要回到的地址和结果 */
  async complete(input: { code?: string; state?: string; error?: string }, nonce: string | undefined, fallback: string): Promise<{ returnTo: string; result: ClaimResult }> {
    const state = input.state ? this.verify(input.state) : null
    if (!state) return { returnTo: fallback, result: 'expired' }
    const done = (result: ClaimResult) => ({ returnTo: state.r, result })
    if (input.error) return done('cancelled')
    if (!input.code || !nonce || nonce !== state.c || state.x < this.now()) return done('expired')

    try {
      const token = await this.github!.exchange(input.code)
      if (!token) return done('expired')
      try {
        return done(await this.verifyAndSave(token, state))
      } finally {
        this.github!.revoke(token).catch((err: Error) => this.logger.warn({ err: err.message }, '吊销认领用的 GitHub 令牌失败'))
      }
    } catch (err) {
      this.logger.error({ slug: state.s, err: (err as Error).message }, '认领验证出错')
      return done('error')
    }
  }

  private async verifyAndSave(token: string, state: StatePayload): Promise<ClaimResult> {
    const target = await this.repository.target(KIND, state.s)
    if (!target?.repository || target.repository.host !== 'github.com') return 'error'
    const [user, repo] = await Promise.all([this.github!.user(token), this.github!.repo(token, target.repository.owner, target.repository.name)])
    const method = !repo ? null : repo.ownerId === user.id ? 'owner' : repo.permissions?.admin || repo.permissions?.maintain ? 'maintainer' : null
    if (!repo || !method) {
      this.logger.info({ slug: target.slug, github: user.login, repo: `${target.repository.owner}/${target.repository.name}` }, '认领被拒绝：不是仓库所有者或管理员')
      return 'denied'
    }
    const row = await this.repository.find(KIND, target.slug)
    if (row && !row.revokedAt && row.githubId !== user.id) return 'taken'
    if (row?.revokedAt && row.githubId === user.id) return 'revoked'
    await this.repository.save({
      kind: KIND,
      slug: target.slug,
      userId: state.u,
      userName: state.n,
      githubId: user.id,
      githubLogin: user.login,
      githubAvatar: user.avatarUrl,
      repoFullName: repo.fullName,
      method,
      claimedAt: new Date(this.now()),
    })
    this.logger.info({ slug: target.slug, github: user.login, method }, '认领成功')
    return 'ok'
  }
}
