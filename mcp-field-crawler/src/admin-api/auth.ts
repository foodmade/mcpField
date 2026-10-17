import { and, eq, gt, lt } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db/client.ts'
import { adminSessions, adminUsers } from '../db/schema/index.ts'
import { hashPassword, passwordProblem, verifyPassword } from '../admin/password.ts'
import { ApiError } from '../api/http/errors.ts'

/*
 * 后台账号与会话：登录成功发一个随机令牌放进 HttpOnly cookie，库里只存它的 SHA-256。
 * 会话 7 天有效，用着就顺延；连续输错 5 次锁定 15 分钟；改密码后其他会话全部失效。
 */

export const SESSION_TTL_MS = 7 * 24 * 3600_000
const MAX_ATTEMPTS = 5
const LOCK_MS = 15 * 60_000
/** 会话最后使用时间超过这么久才写库顺延，免得每个请求都写一次 */
const TOUCH_MS = 3600_000

export interface AdminUser {
  id: number
  username: string
  lastLoginAt: string | null
  passwordChangedAt: string | null
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** 用户不存在时也算一次哈希，响应时间不暴露用户名是否存在 */
const DUMMY_HASH = hashPassword('not-a-real-password')

export class AdminAuth {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(username: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<{ token: string; user: AdminUser }> {
    const [user] = await this.db.select().from(adminUsers).where(eq(adminUsers.username, username))
    const now = this.now()
    if (!user) {
      await verifyPassword(password, await DUMMY_HASH)
      throw new ApiError(401, 'invalid_credentials', '账号或密码错误')
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000)
      throw new ApiError(423, 'locked', `连续输错次数过多，请 ${minutes} 分钟后再试`)
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const attempts = user.failedAttempts + 1
      const locked = attempts >= MAX_ATTEMPTS
      await this.db
        .update(adminUsers)
        .set({ failedAttempts: locked ? 0 : attempts, lockedUntil: locked ? new Date(now.getTime() + LOCK_MS) : null })
        .where(eq(adminUsers.id, user.id))
      if (locked) throw new ApiError(423, 'locked', `连续输错 ${MAX_ATTEMPTS} 次，账号已锁定 15 分钟`)
      throw new ApiError(401, 'invalid_credentials', `账号或密码错误，还可尝试 ${MAX_ATTEMPTS - attempts} 次`, { remaining: MAX_ATTEMPTS - attempts })
    }
    await this.db.update(adminUsers).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now }).where(eq(adminUsers.id, user.id))
    const token = randomBytes(32).toString('base64url')
    await this.db.insert(adminSessions).values({
      tokenHash: tokenHash(token),
      userId: user.id,
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    // 顺手清掉过期的会话
    await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, now))
    return { token, user: present({ ...user, lastLoginAt: now }) }
  }

  /** 令牌对应的用户；无效或过期返回 null */
  async authenticate(token: string | undefined): Promise<{ user: AdminUser; sessionId: number } | null> {
    if (!token) return null
    const now = this.now()
    const [row] = await this.db
      .select({ session: adminSessions, user: adminUsers })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
      .where(and(eq(adminSessions.tokenHash, tokenHash(token)), gt(adminSessions.expiresAt, now)))
    if (!row) return null
    if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_MS) {
      await this.db.update(adminSessions).set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) }).where(eq(adminSessions.id, row.session.id))
    }
    return { user: present(row.user), sessionId: row.session.id }
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash(token)))
  }

  /** 改密码：核对当前密码，成功后只保留当前会话 */
  async changePassword(userId: number, sessionId: number, current: string, next: string): Promise<void> {
    const [user] = await this.db.select().from(adminUsers).where(eq(adminUsers.id, userId))
    if (!user || !(await verifyPassword(current, user.passwordHash))) throw new ApiError(400, 'wrong_password', '当前密码不正确')
    const problem = passwordProblem(next)
    if (problem) throw ApiError.badRequest(problem)
    if (current === next) throw ApiError.badRequest('新密码不能和当前密码相同')
    await this.db.update(adminUsers).set({ passwordHash: await hashPassword(next), passwordChangedAt: this.now() }).where(eq(adminUsers.id, userId))
    const sessions = await this.db.select({ id: adminSessions.id }).from(adminSessions).where(eq(adminSessions.userId, userId))
    for (const s of sessions) if (s.id !== sessionId) await this.db.delete(adminSessions).where(eq(adminSessions.id, s.id))
  }
}

function present(user: typeof adminUsers.$inferSelect): AdminUser {
  return {
    id: user.id,
    username: user.username,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
  }
}
