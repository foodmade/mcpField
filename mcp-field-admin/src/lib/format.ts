/* 数字、时间、时长的显示（时间一律按北京时间） */

export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'))

export const compact = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

const beijing = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString()

/** 03:30 */
export const clock = (iso: string | null) => (iso ? beijing(iso).slice(11, 16) : '—')
/** 03:30:02 */
export const clockSec = (iso: string | null) => (iso ? beijing(iso).slice(11, 19) : '—')
/** 10-17 03:30 */
export const dateTime = (iso: string | null) => (iso ? `${beijing(iso).slice(5, 10)} ${beijing(iso).slice(11, 16)}` : '—')
/** 2026-10-17 */
export const day = (iso: string | null) => (iso ? beijing(iso).slice(0, 10) : '—')

/** 3 分钟前 / 5 小时前 / 4 天前，超过 30 天显示 10-17 03:30 */
export function ago(iso: string | null): string {
  if (!iso) return '—'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  if (min < 24 * 60) return `${Math.floor(min / 60)} 小时前`
  if (min < 30 * 24 * 60) return `${Math.floor(min / 1440)} 天前`
  return dateTime(iso)
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分`
  return `${Math.floor(m / 60)} 时 ${m % 60} 分`
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const weekday = (date: string) => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]

export function shiftDate(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10)
}

export const todayBeijing = () => beijing(new Date().toISOString()).slice(0, 10)
