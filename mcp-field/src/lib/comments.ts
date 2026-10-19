import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Kind } from './api/entities'
import { apiGet, apiSend } from './api/http'
import { accessToken, useSession } from './auth'

export type Reaction = 'up' | 'party' | 'heart' | 'rocket'
export type Comment = {
  id: string
  author: string
  avatar: string | null
  /** Markdown 原文 */
  body: string
  createdAt: string
  reactions: Partial<Record<Reaction, number>>
  /** 自己点过的回应 */
  mine: Reaction[]
  /** 自己发的，可以删除 */
  own: boolean
  replies?: Comment[]
}

/** 评论对象标识：类型 + slug，例如 server:playwright-mcp */
export type CommentTarget = `${Kind}:${string}`

export type CommentSort = 'newest' | 'oldest' | 'top'
export const COMMENT_SORTS: CommentSort[] = ['newest', 'oldest', 'top']

type Page = { data: Comment[]; meta: { page: number; total: number; totalPages: number; count: number } }

/** 一次加载的顶层评论数 */
const PAGE_SIZE = 10

const AVATAR_COLORS = ['#5B8DEF', '#FC6D26', '#9B6CE0', '#3DB88B', '#E5484D', '#D9944A', '#2BA6C9', '#C2569B']
/** 没有头像时按名字取一个固定的底色 */
export const colorOf = (name: string) => AVATAR_COLORS[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length]

const pathOf = (target: CommentTarget) => {
  const i = target.indexOf(':')
  return `/comments/${target.slice(0, i)}/${encodeURIComponent(target.slice(i + 1))}`
}

/* 页内导航上的评论数：评论区加载后写入，导航订阅；服务端渲染时为 0 */
const counts = new Map<string, number>()
const countListeners = new Set<() => void>()
const setCount = (target: string, n: number) => {
  counts.set(target, n)
  countListeners.forEach((l) => l())
}
const subscribeCount = (cb: () => void) => {
  countListeners.add(cb)
  return () => countListeners.delete(cb)
}

export const useCommentCount = (target: CommentTarget) =>
  useSyncExternalStore(subscribeCount, () => counts.get(target) ?? 0, () => 0)

type Loaded = { key: string | null; comments: Comment[]; page: number; totalPages: number; count: number; error?: boolean }

const fetchPage = async (target: CommentTarget, sort: CommentSort, page: number, signal?: AbortSignal) =>
  apiGet<Page>(pathOf(target), { sort, page, pageSize: PAGE_SIZE }, signal, await accessToken())

const patch = (list: Comment[], id: string, fn: (c: Comment) => Comment): Comment[] =>
  list.map((c) => (c.id === id ? fn(c) : c.replies?.some((r) => r.id === id) ? { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) } : c))

/**
 * 某个条目的评论：分页加载、发表、回复、删除、回应。
 * 读取不需要登录；登录状态变化后重新加载（带上自己的回应和可删除标记）。
 */
export function useComments(target: CommentTarget) {
  const { user, pending } = useSession()
  const [sort, setSort] = useState<CommentSort>('newest')
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<Loaded>({ key: null, comments: [], page: 0, totalPages: 0, count: 0 })
  const [loadingMore, setLoadingMore] = useState(false)
  // 会话读取完成前不请求，避免先按未登录加载一次、登录后再加载一次
  const key = pending ? null : `${target}|${sort}|${user?.id ?? ''}|${nonce}`

  useEffect(() => {
    if (key === null) return
    const ctrl = new AbortController()
    fetchPage(target, sort, 1, ctrl.signal).then(
      (res) => setState({ key, comments: res.data, page: 1, totalPages: res.meta.totalPages, count: res.meta.count }),
      () => !ctrl.signal.aborted && setState((s) => ({ ...s, key, error: true })),
    )
    return () => ctrl.abort()
  }, [key, target, sort])

  useEffect(() => setCount(target, state.count), [target, state.count])

  const status = key === null || state.key !== key ? 'loading' : state.error ? 'error' : 'ready'
  const { comments } = state
  const edit = (fn: (list: Comment[]) => Comment[], delta = 0) => setState((s) => ({ ...s, comments: fn(s.comments), count: Math.max(0, s.count + delta) }))

  const more = async () => {
    setLoadingMore(true)
    try {
      const res = await fetchPage(target, sort, state.page + 1)
      // 翻页期间有人发了新评论时，下一页会和已加载的重叠，去掉重复的
      setState((s) => {
        const seen = new Set(s.comments.map((c) => c.id))
        return { ...s, comments: [...s.comments, ...res.data.filter((c) => !seen.has(c.id))], page: res.meta.page, totalPages: res.meta.totalPages, count: res.meta.count }
      })
    } finally {
      setLoadingMore(false)
    }
  }

  const add = async (body: string) => {
    const { data } = await apiSend<{ data: Comment }>('POST', pathOf(target), { body }, await accessToken())
    edit((list) => (sort === 'oldest' ? [...list, data] : [data, ...list]), 1)
  }

  const reply = async (parentId: string, body: string) => {
    const { data } = await apiSend<{ data: Comment }>('POST', pathOf(target), { body, parentId: Number(parentId) }, await accessToken())
    edit((list) => list.map((c) => (c.id === parentId ? { ...c, replies: [...(c.replies ?? []), data] } : c)), 1)
  }

  const remove = async (id: string) => {
    await apiSend('DELETE', `/comments/${id}`, undefined, await accessToken())
    const top = comments.find((c) => c.id === id)
    edit((list) => list.filter((c) => c.id !== id).map((c) => (c.replies?.some((r) => r.id === id) ? { ...c, replies: c.replies.filter((r) => r.id !== id) } : c)), -(top ? 1 + (top.replies?.length ?? 0) : 1))
  }

  /** 先在界面上切换，请求失败时恢复 */
  const react = async (id: string, reaction: Reaction) => {
    const c = comments.flatMap((x) => [x, ...(x.replies ?? [])]).find((x) => x.id === id)
    if (!c) return
    const on = !c.mine.includes(reaction)
    const flip = (x: Comment, to: boolean): Comment => ({
      ...x,
      mine: to ? [...x.mine.filter((r) => r !== reaction), reaction] : x.mine.filter((r) => r !== reaction),
      reactions: { ...x.reactions, [reaction]: Math.max(0, (x.reactions[reaction] ?? 0) + (to ? 1 : -1)) },
    })
    edit((list) => patch(list, id, (x) => flip(x, on)))
    try {
      const { data } = await apiSend<{ data: Pick<Comment, 'reactions' | 'mine'> }>(on ? 'PUT' : 'DELETE', `/comments/${id}/reactions/${reaction}`, undefined, await accessToken())
      edit((list) => patch(list, id, (x) => ({ ...x, ...data })))
    } catch (error) {
      edit((list) => patch(list, id, (x) => flip(x, !on)))
      throw error
    }
  }

  return { comments, count: state.count, hasMore: state.page < state.totalPages, status, loadingMore, sort, setSort, reload: () => setNonce((n) => n + 1), more, add, reply, remove, react }
}
