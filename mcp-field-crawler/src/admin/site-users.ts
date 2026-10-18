import { lt, sql } from 'drizzle-orm'
import type { Logger } from '../core/logger.ts'
import type { Db } from '../db/client.ts'
import { adminSiteUsers } from '../db/schema/index.ts'

/*
 * 网站注册用户同步：账号在 Supabase Auth，用管理接口（GET /auth/v1/admin/users，需要 service_role key）分页读全部用户，
 * 写进 admin_site_users；这次没读到的（在 Supabase 里删掉了）一并删除。
 * 跑在后台接口进程里，每 10 分钟一次，后台用户页可以手动触发。
 */

export interface SupabaseAdminConfig {
  url: string
  serviceRoleKey: string
}

/** 管理接口返回的用户（只列用到的字段） */
export interface SupabaseUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  banned_until?: string | null
  created_at: string
  last_sign_in_at?: string | null
  app_metadata?: { provider?: string; providers?: string[] } | null
  user_metadata?: Record<string, unknown> | null
}

export type SiteUserRow = typeof adminSiteUsers.$inferInsert

const PER_PAGE = 1000
/** 保存时用的批大小 */
const BATCH = 500

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const time = (v: string | null | undefined) => (v ? new Date(v) : null)

/** Supabase 用户 → 表里的一行：显示名和头像的取法与评论接口一致（GitHub 账号名优先） */
export function siteUserRow(user: SupabaseUser, syncedAt: Date): SiteUserRow {
  const meta = user.user_metadata ?? {}
  const providers = [...new Set(user.app_metadata?.providers ?? (user.app_metadata?.provider ? [user.app_metadata.provider] : []))].sort()
  const avatar = str(meta.avatar_url, 512) ?? str(meta.picture, 512)
  const banned = time(user.banned_until)
  return {
    id: user.id,
    email: str(user.email, 255),
    name: str(meta.user_name, 100) ?? str(meta.preferred_username, 100) ?? str(meta.full_name, 100) ?? str(meta.name, 100),
    avatarUrl: avatar?.startsWith('https://') ? avatar : null,
    providers: providers.join(',').slice(0, 64),
    githubLogin: providers.includes('github') ? str(meta.user_name, 100) ?? str(meta.preferred_username, 100) : null,
    locale: str(meta.locale, 8),
    emailConfirmedAt: time(user.email_confirmed_at),
    bannedUntil: banned && !Number.isNaN(banned.getTime()) ? banned : null,
    registeredAt: new Date(user.created_at),
    lastSignInAt: time(user.last_sign_in_at),
    syncedAt,
  }
}

/** 分页读全部用户：按返回的 x-total-count 判断是否读完（服务端可能把每页条数调小） */
export async function fetchSupabaseUsers(config: SupabaseAdminConfig, fetchFn: typeof fetch = fetch): Promise<SupabaseUser[]> {
  const users: SupabaseUser[] = []
  for (let page = 1; ; page++) {
    const res = await fetchFn(`${config.url}/auth/v1/admin/users?page=${page}&per_page=${PER_PAGE}`, {
      headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Supabase 用户接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`)
    const body = (await res.json()) as { users?: SupabaseUser[] }
    const batch = body.users ?? []
    users.push(...batch)
    const total = Number(res.headers.get('x-total-count'))
    if (!batch.length || (Number.isFinite(total) && total > 0 ? users.length >= total : batch.length < PER_PAGE)) return users
  }
}

export class SiteUserSync {
  private timer: ReturnType<typeof setInterval> | undefined
  private running: Promise<{ users: number; removed: number }> | null = null

  constructor(
    private readonly db: Db,
    private readonly config: SupabaseAdminConfig,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  start(intervalMs = 10 * 60_000): void {
    this.timer = setInterval(() => this.kick(), intervalMs)
    this.timer.unref?.()
    this.kick()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  kick(): void {
    this.sync().catch((error: unknown) => this.logger.warn({ err: (error as Error).message }, '网站用户同步失败，下次再试'))
  }

  /** 同步一次；正在同步时等这一次的结果 */
  sync(): Promise<{ users: number; removed: number }> {
    this.running ??= this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<{ users: number; removed: number }> {
    const syncedAt = new Date()
    const users = await fetchSupabaseUsers(this.config, this.fetchFn)
    const rows = users.map((u) => siteUserRow(u, syncedAt))
    for (let i = 0; i < rows.length; i += BATCH) {
      await this.db
        .insert(adminSiteUsers)
        .values(rows.slice(i, i + BATCH))
        .onDuplicateKeyUpdate({
          set: Object.fromEntries(
            (['email', 'name', 'avatarUrl', 'providers', 'githubLogin', 'locale', 'emailConfirmedAt', 'bannedUntil', 'registeredAt', 'lastSignInAt', 'syncedAt'] as const).map((k) => [k, sql.raw(`VALUES(\`${adminSiteUsers[k].name}\`)`)]),
          ),
        })
    }
    // 一个都没读到时不删，免得接口异常时清空列表
    const removed = rows.length ? Number((await this.db.delete(adminSiteUsers).where(lt(adminSiteUsers.syncedAt, syncedAt)))[0].affectedRows) : 0
    this.logger.info({ users: rows.length, removed }, '网站用户同步完成')
    return { users: rows.length, removed }
  }
}
