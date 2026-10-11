import { setTimeout as sleep } from 'node:timers/promises'
import type { FetchMiddleware } from './compose.ts'

/** 按主机限速：同一主机的请求之间至少间隔 1 / requestsPerSecond 秒 */
export function withRateLimit(options: { requestsPerSecond: number }): FetchMiddleware {
  const interval = 1000 / options.requestsPerSecond
  const nextSlot = new Map<string, number>()

  return (next) => ({
    async fetch(request) {
      const host = new URL(request.url).host
      const now = Date.now()
      const slot = Math.max(now, nextSlot.get(host) ?? 0)
      nextSlot.set(host, slot + interval)
      if (slot > now) await sleep(slot - now)
      return next.fetch(request)
    },
  })
}
