import { describe, expect, it } from 'vitest'
import { fetchSupabaseUsers, siteUserRow, type SupabaseUser } from '../src/admin/site-users.ts'

const syncedAt = new Date('2026-10-18T02:00:00Z')

describe('siteUserRow', () => {
  it('GitHub + Google：显示名用 GitHub 账号名，登录方式排序去重', () => {
    const row = siteUserRow(
      {
        id: 'u1',
        email: 'alice@rivera.io',
        email_confirmed_at: '2026-10-17T14:13:00Z',
        created_at: '2026-10-17T14:13:00.123Z',
        last_sign_in_at: '2026-10-18T00:12:00Z',
        app_metadata: { provider: 'github', providers: ['google', 'github', 'github'] },
        user_metadata: { user_name: 'alice-r', full_name: 'Alice Rivera', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
      },
      syncedAt,
    )
    expect(row).toMatchObject({ name: 'alice-r', githubLogin: 'alice-r', providers: 'github,google', avatarUrl: 'https://avatars.githubusercontent.com/u/1', bannedUntil: null, syncedAt })
    expect(row.registeredAt.toISOString()).toBe('2026-10-17T14:13:00.123Z')
  })

  it('邮箱验证码登录：没有显示名和头像，带界面语言；未验证时验证时间为空', () => {
    const row = siteUserRow({ id: 'u2', email: 'x@163.com', created_at: '2026-10-17T11:02:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { email: 'x@163.com', locale: 'zh' } }, syncedAt)
    expect(row).toMatchObject({ name: null, avatarUrl: null, githubLogin: null, providers: 'email', locale: 'zh', emailConfirmedAt: null, lastSignInAt: null })
  })

  it('Google 用 picture 作头像，非 https 的头像不要', () => {
    expect(siteUserRow({ id: 'u3', created_at: '2026-10-01T00:00:00Z', app_metadata: { provider: 'google' }, user_metadata: { name: 'Kenji', picture: 'https://lh3.googleusercontent.com/a' } }, syncedAt)).toMatchObject({ name: 'Kenji', providers: 'google', avatarUrl: 'https://lh3.googleusercontent.com/a' })
    expect(siteUserRow({ id: 'u4', created_at: '2026-10-01T00:00:00Z', user_metadata: { avatar_url: 'http://x/a.png' } }, syncedAt)).toMatchObject({ avatarUrl: null, providers: '' })
  })

  it('封禁时间原样保存', () => {
    expect(siteUserRow({ id: 'u5', created_at: '2026-10-01T00:00:00Z', banned_until: '2126-01-01T00:00:00Z' }, syncedAt).bannedUntil?.toISOString()).toBe('2126-01-01T00:00:00.000Z')
  })
})

describe('fetchSupabaseUsers', () => {
  const user = (i: number): SupabaseUser => ({ id: `u${i}`, created_at: '2026-10-01T00:00:00Z' })

  it('带 service_role key 分页读，按总数判断读完（服务端把每页条数调小时也不会漏）', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const all = Array.from({ length: 5 }, (_, i) => user(i))
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> })
      const page = Number(new URL(url).searchParams.get('page'))
      return new Response(JSON.stringify({ users: all.slice((page - 1) * 2, page * 2) }), { headers: { 'x-total-count': '5' } })
    }) as unknown as typeof fetch
    const users = await fetchSupabaseUsers({ url: 'https://p.supabase.co', serviceRoleKey: 'k' }, fn)
    expect(users.map((u) => u.id)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'])
    expect(calls).toHaveLength(3)
    expect(calls[0]!.url).toBe('https://p.supabase.co/auth/v1/admin/users?page=1&per_page=1000')
    expect(calls[0]!.headers).toMatchObject({ apikey: 'k', Authorization: 'Bearer k' })
  })

  it('接口出错时抛错', async () => {
    const fn = (async () => new Response('{"msg":"invalid JWT"}', { status: 401 })) as unknown as typeof fetch
    await expect(fetchSupabaseUsers({ url: 'https://p.supabase.co', serviceRoleKey: 'bad' }, fn)).rejects.toThrow('401')
  })
})
