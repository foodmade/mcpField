import { useEffect, useRef, useState } from 'react'

type Result<T> = { key: string; data?: T; error?: Error }

/**
 * 按 key 加载数据：key 变化时重新请求并取消上一次请求；key 为 null 时不请求。
 * 加载状态由"最近一次完成的请求是否对应当前 key"推导，不在 effect 里同步改 state。
 * keepPrevious：加载新数据期间保留旧数据（列表翻页、筛选时避免闪烁）。
 */
export function useApi<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, { keepPrevious = false } = {}) {
  const [nonce, setNonce] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const requestKey = key === null ? null : `${key}#${nonce}`

  useEffect(() => {
    if (requestKey === null) return
    const ctrl = new AbortController()
    fetcherRef.current(ctrl.signal).then(
      (data) => setResult({ key: requestKey, data }),
      (error: Error) => {
        if (!ctrl.signal.aborted) setResult({ key: requestKey, error })
      },
    )
    return () => ctrl.abort()
  }, [requestKey])

  const settled = result !== null && result.key === requestKey
  return {
    data: settled ? result.data : keepPrevious ? result?.data : undefined,
    error: settled ? result.error : undefined,
    loading: requestKey !== null && !settled,
    reload: () => setNonce((n) => n + 1),
  }
}

/** 输入框防抖：停止输入 delay 毫秒后才更新 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
