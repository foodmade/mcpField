import { useCallback, useEffect, useRef, useState } from 'react'
import type { Kind, RunState, Stage, StageState } from './labels'

/* 后台接口（mcp-field-crawler/src/admin-api）：同域请求，登录态在 HttpOnly cookie 里 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 收到 401 时通知外层回到登录页 */
let onUnauthorized: (() => void) | undefined
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  })
  const json = (await res.json().catch(() => ({}))) as { data?: T; meta?: unknown; error?: { code: string; message: string } }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.()
    throw new ApiError(res.status, json.error?.code ?? 'error', json.error?.message ?? `请求失败（${res.status}）`)
  }
  // 分页列表是 { data, meta }，整个返回；其余接口取 data
  return (json.meta === undefined ? (json.data ?? json) : json) as T
}

/** 读接口：首次加载 + 可选的定时刷新（页面在后台时不刷新） */
export function useApi<T>(path: string | null, refreshMs?: number | ((data: T | undefined) => number | undefined)) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const dataRef = useRef<T>(undefined)

  const load = useCallback(async () => {
    if (!path) return
    try {
      const value = await api<T>(path)
      dataRef.current = value
      setData(value)
      setError(undefined)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    if (!refreshMs) return
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const ms = typeof refreshMs === 'function' ? refreshMs(dataRef.current) : refreshMs
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await load()
        tick()
      }, ms ?? 60_000)
    }
    tick()
    return () => clearTimeout(timer)
  }, [load, refreshMs])

  return { data, error, loading, reload: load }
}

/* ========== 接口返回的结构 ========== */

export interface AdminUser {
  id: number
  username: string
  lastLoginAt: string | null
  passwordChangedAt: string | null
}

export interface LogLine {
  at: string
  level: string
  msg: string
  detail?: string
}

export interface Run {
  id: number
  batchId: number | null
  step: string
  args: string
  status: RunState
  progress: { done: number; total: number } | null
  counts: { ok: number | null; review: number | null; failed: number | null }
  error: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number
  logTail: LogLine[]
  summary?: unknown
}

export interface Step {
  step: string
  status: RunState
  startedAt: string | null
  finishedAt: string | null
  durationMs: number
  progress: { done: number; total: number } | null
  counts: { ok: number; review: number; failed: number }
  error: string | null
  runs: Run[]
}

export interface Batch {
  id: number
  trigger: string
  date: string
  status: RunState
  startedAt: string
  finishedAt: string | null
  durationMs: number
  steps: Step[]
  extra: Run[]
}

export interface Coverage {
  kind: Kind
  stage: Stage
  na: number
  pending: number
  ok: number
  warn: number
  failed: number
}

export interface Dashboard {
  today: string
  batch: Batch | null
  daily: { date: string; byKind: Record<Kind, number>; total: number; status: RunState | null }[]
  totals: Record<Kind, number>
  failingItems: Partial<Record<Kind, number>>
  coverage: Coverage[]
  issues: (Run & { resolved: boolean; message: string | null })[]
}

export interface Daily {
  date: string
  batch: Batch | null
  history: { date: string; status: RunState | null }[]
  manual: Run[]
  newByKind: Record<Kind, number>
}

export interface Item {
  kind: Kind
  slug: string
  name: string
  iconUrl: string | null
  category: string | null
  sources: string[]
  popularity: number | null
  firstSeenAt: string
  publishedAt: string
  active: boolean
  url: string
  stages: Record<Stage, { state: StageState; note: string | null }>
}

export interface ItemPage {
  data: Item[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface Facets {
  categories: { slug: string; count: number }[]
  sources: { id: string; count: number }[]
}

export interface LogFile {
  file: string
  lines: string[]
  size: number
  updatedAt: string | null
}

export type SiteUserStatus = 'active' | 'unverified' | 'banned'

/** 网站注册用户（Supabase Auth 同步过来的副本） */
export interface SiteUser {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  /** github / google / email */
  providers: string[]
  githubLogin: string | null
  locale: string | null
  registeredAt: string
  lastSignInAt: string | null
  emailConfirmedAt: string | null
  bannedUntil: string | null
  status: SiteUserStatus
  comments: number
}

export interface SiteUserPage {
  data: SiteUser[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface SiteUserSummary {
  total: number
  today: number
  new7d: number
  prev7d: number
  signIn7d: number
  providers: { github: number; google: number; email: number }
  comments: number
  commenters: number
  syncedAt: string | null
  syncEnabled: boolean
}

export interface SiteUserDetail extends SiteUser {
  reactions: number
  recentComments: { id: number; kind: Kind; slug: string; parentId: number | null; body: string; createdAt: string; name: string | null; url: string }[]
}

/** 查询参数：去掉空值 */
export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false) as [string, string | number][]
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : ''
}
