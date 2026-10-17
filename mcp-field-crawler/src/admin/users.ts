import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.ts'
import { adminSessions, adminUsers } from '../db/schema/index.ts'
import { hashPassword, passwordProblem } from './password.ts'

/** 创建后台账号，已存在则重设密码（并让它已登录的会话全部失效）；返回是否新建 */
export async function setAdminPassword(db: Db, username: string, password: string): Promise<boolean> {
  const problem = passwordProblem(password)
  if (problem) throw new Error(problem)
  if (!/^[\w.-]{2,64}$/.test(username)) throw new Error('用户名只能用字母、数字、下划线、点和短横线，2 到 64 个字符')
  const passwordHash = await hashPassword(password)
  const [existing] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, username))
  if (existing) {
    await db.update(adminUsers).set({ passwordHash, failedAttempts: 0, lockedUntil: null, passwordChangedAt: new Date() }).where(eq(adminUsers.id, existing.id))
    await db.delete(adminSessions).where(eq(adminSessions.userId, existing.id))
    return false
  }
  await db.insert(adminUsers).values({ username, passwordHash, passwordChangedAt: new Date() })
  return true
}
