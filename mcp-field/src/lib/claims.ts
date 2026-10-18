import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useI18n } from '../i18n/context'
import { apiGet, apiSend } from './api/http'
import { authConfigured, supabase, useSession } from './auth'

/* MCP 服务认领：与后端 mcp-field-crawler/src/api/modules/claims 对应 */

export type ClaimStatus = {
  /** 关联了 GitHub 仓库，可以认领 */
  claimable: boolean
  claim: { login: string; avatar: string | null; method: 'owner' | 'maintainer'; claimedAt: string } | null
  /** 当前登录用户认领的 */
  mine: boolean
}

/** GitHub 跳回详情页时带的 ?claim= 结果 */
export const CLAIM_RESULTS = ['ok', 'cancelled', 'expired', 'denied', 'taken', 'revoked', 'error'] as const
export type ClaimResult = (typeof CLAIM_RESULTS)[number] | 'failed'

/** 登录后回到详情页、自动继续认领的标记 */
const RESUME = 'start'

async function token(): Promise<string | undefined> {
  if (!authConfigured) return undefined
  return (await supabase().auth.getSession()).data.session?.access_token
}

/** 去掉地址里的 claim 参数（不触发路由的数据重新加载） */
function stripClaimParam(): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('claim')
  const path = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', path)
  return path
}

/**
 * 某个 MCP 服务的认领状态与一键认领：
 * 未登录先去登录页（回来时带 ?claim=start 自动继续）；已登录直接跳 GitHub 授权，授权过的用户 GitHub 会立即跳回。
 * 认领状态只在浏览器里读取（页面 HTML 会被 CDN 缓存），服务端渲染时为 null。
 */
export function useClaim(slug: string) {
  const { user, pending } = useSession()
  const { to } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [status, setStatus] = useState<ClaimStatus | null>(null)
  const [result, setResult] = useState<ClaimResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [resume, setResume] = useState(false)

  useEffect(() => {
    if (pending) return
    const controller = new AbortController()
    void token()
      .then((t) => apiGet<{ data: ClaimStatus }>(`/claims/servers/${encodeURIComponent(slug)}`, {}, controller.signal, t))
      .then((r) => setStatus(r.data))
      .catch(() => controller.signal.aborted || setStatus(null))
    return () => controller.abort()
  }, [slug, user?.id, pending])

  // 读一次地址里的结果或继续标记，然后从地址里去掉
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('claim')
    if (!value) return
    if (value === RESUME) setResume(true)
    else if ((CLAIM_RESULTS as readonly string[]).includes(value)) setResult(value as ClaimResult)
    stripClaimParam()
  }, [slug])

  const start = useCallback(async () => {
    if (!user) {
      navigate(`${to('/login')}?redirect=${encodeURIComponent(`${pathname}?claim=${RESUME}`)}`)
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const returnTo = stripClaimParam()
      const { data } = await apiSend<{ data: { url: string } }>('POST', `/claims/servers/${encodeURIComponent(slug)}/start`, { returnTo }, await token())
      window.location.assign(data.url)
    } catch (error) {
      setBusy(false)
      const code = (error as { code?: string }).code
      setResult(code === 'taken' ? 'taken' : 'failed')
    }
  }, [user, slug, pathname, navigate, to])

  // 登录后回来：会话和认领状态都读到了就自动发起
  useEffect(() => {
    if (!resume || pending || !status) return
    setResume(false)
    if (user && status?.claimable && !status.claim) void start()
  }, [resume, pending, user, status, start])

  return { status, result, busy, start, dismiss: () => setResult(null) }
}
