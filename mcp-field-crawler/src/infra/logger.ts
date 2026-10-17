import { pino } from 'pino'
import type { Logger } from '../core/logger.ts'

/** 日志观察者：任务埋点用它拿进度和警告（见 admin/jobs.ts），子 logger 的日志也会经过它 */
export type LogObserver = (level: number, obj: Record<string, unknown> | undefined, msg: string | undefined) => void

export function createLogger(level: string, observer?: { current?: LogObserver }): Logger {
  return pino({
    level,
    transport: process.stdout.isTTY ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
    // 不能传 hooks: undefined，pino 会读它的 logMethod 报错
    ...(observer && {
      hooks: {
        logMethod(args, method, lvl) {
          const [first, second] = args as unknown[]
          const obj = first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined
          observer.current?.(lvl, obj, typeof first === 'string' ? first : typeof second === 'string' ? second : undefined)
          return method.apply(this, args)
        },
      },
    }),
  })
}
