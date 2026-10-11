import { pino } from 'pino'
import type { Logger } from '../core/logger.ts'

export function createLogger(level: string): Logger {
  return pino({
    level,
    transport: process.stdout.isTTY ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
  })
}
