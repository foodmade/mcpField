/** 核心层只依赖这个最小日志接口，具体实现（pino）在 infra 层注入 */
export interface LogFn {
  (msg: string): void
  (obj: object, msg?: string): void
}

export interface Logger {
  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  child(bindings: Record<string, unknown>): Logger
}
