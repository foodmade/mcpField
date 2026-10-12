import { createClient, type AuthError, type SupabaseClient, type User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

/*
 * 账号与登录：Supabase Auth（GitHub、Google、邮箱验证码）。
 * 浏览器直接和 Supabase 通信，会话保存在 localStorage，由 supabase-js 自动续期。
 * 页面 HTML 会被 CDN 缓存，登录状态一律在浏览器端读取，服务端渲染时按未登录处理。
 * 第三方登录用 PKCE：授权后回到登录页，URL 带 ?code=，客户端初始化时自动换成会话。
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** 没有配置 Supabase 时（例如本地没填 .env）登录入口仍然显示，但点击后提示暂不可用 */
export const authConfigured = !!(SUPABASE_URL && SUPABASE_KEY)

let client: SupabaseClient | null = null

/** 只在浏览器里创建，服务端渲染不碰会话 */
export function supabase(): SupabaseClient {
  if (!authConfigured) throw new Error('未配置 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')
  client ??= createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
  return client
}

export type SocialProvider = 'github' | 'google'

/** 验证码位数和有效期，需与 Supabase 后台的 Email OTP Length / Expiration 一致 */
export const OTP_LENGTH = 6
export const OTP_MINUTES = 10

/** 当前登录用户；读取完成前 pending 为 true */
export function useSession(): { user: User | null; pending: boolean } {
  const [state, setState] = useState<{ user: User | null; pending: boolean }>({ user: null, pending: authConfigured })
  useEffect(() => {
    if (!authConfigured) return
    const auth = supabase().auth
    let active = true
    void auth.getSession().then(({ data }) => active && setState({ user: data.session?.user ?? null, pending: false }))
    const { data } = auth.onAuthStateChange((_event, session) => setState({ user: session?.user ?? null, pending: false }))
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])
  return state
}

/** 头像和显示名：GitHub 给 avatar_url / user_name，Google 给 picture / full_name，邮箱登录只有邮箱 */
export function profile(user: User): { name: string; email: string; avatar: string | null } {
  const meta = user.user_metadata as Record<string, string | undefined>
  const email = user.email ?? ''
  return {
    name: meta.full_name || meta.name || meta.user_name || email.split('@')[0] || '',
    email,
    avatar: meta.avatar_url || meta.picture || null,
  }
}

/** 后台已启用的第三方登录方式（读 Supabase 的公开设置），读取失败时按全部可用处理，点击后再报错 */
export async function enabledProviders(): Promise<Record<SocialProvider, boolean>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY! } })
    const body = (await res.json()) as { external?: Partial<Record<SocialProvider, boolean>> }
    return { github: !!body.external?.github, google: !!body.external?.google }
  } catch {
    return { github: true, google: true }
  }
}

export type AuthFailure = 'invalidEmail' | 'undeliverable' | 'invalidCode' | 'rateLimited' | 'emailBlocked' | 'network' | 'failed'

export function failureOf(error: AuthError | null | undefined): AuthFailure {
  if (!error || !error.status) return 'network'
  if (error.status === 429) return 'rateLimited'
  switch (error.code) {
    case 'otp_expired':
      return 'invalidCode'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rateLimited'
    // 格式已在页面上检查过；Supabase 的发信服务认为这个地址收不到信（拼写错误、邮箱不存在等）
    case 'email_address_invalid':
      return 'undeliverable'
    // 使用 Supabase 自带的发信服务时，只能发给项目成员的邮箱
    case 'email_address_not_authorized':
      return 'emailBlocked'
    default:
      return 'failed'
  }
}

/** 登录后的去处只接受站内路径，避免被拼成跳到外站的链接 */
export function safeRedirect(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}

/** li.lei@gmail.com → li***@gmail.com */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`
}

export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
