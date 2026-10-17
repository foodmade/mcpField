import { execFile, spawn } from 'node:child_process'
import { closeSync, openSync, writeSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ApiError } from '../api/http/errors.ts'

/*
 * 后台的操作：手动运行某一步、手动跑一遍每日任务、读运行日志。
 * 与 mcpfield run / mcpfield data 的做法一致：nice 降低优先级、日志追加到 logs/ 下、同名命令同时只允许一个；
 * 只能运行白名单里的步骤，不接受任何参数。
 */

/** 可以在后台手动运行的步骤（每日任务的步骤 + 条目状态同步） */
export const RUNNABLE_STEPS = ['crawl', 'classify', 'probe', 'publish', 'assets', 'owner-icons', 'github', 'translate', 'translate-tools', 'describe', 'overview', 'readme', 'admin-sync'] as const
export type RunnableStep = (typeof RUNNABLE_STEPS)[number]

const pexec = promisify(execFile)

/** 进程里是否已经有这个命令在跑（包括不经后台、直接在服务器上启动的） */
async function processRunning(pattern: string): Promise<boolean> {
  try {
    await pexec('pgrep', ['-f', pattern])
    return true
  } catch {
    return false
  }
}

function stamp(): string {
  const d = new Date(Date.now() + 8 * 3600_000).toISOString()
  return `${d.slice(0, 10)} ${d.slice(11, 19)}`
}

function detached(command: string, args: string[], logFile: string, env: NodeJS.ProcessEnv = {}): void {
  const fd = openSync(logFile, 'a')
  writeSync(fd, `[${stamp()}] 开始（后台手动）${[command, ...args].join(' ')}\n`)
  const child = spawn(command, args, { cwd: process.cwd(), detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, ...env } })
  child.unref()
  closeSync(fd)
}

export class AdminActions {
  constructor(private readonly logDir: string) {}

  /** 单独运行某一步（crawl 跑默认的两个来源，由 daily.sh 负责，这里换成只跑这一步的每日任务） */
  async runStep(step: RunnableStep): Promise<void> {
    if (step === 'crawl') return this.runDaily(['crawl'])
    if (await processRunning(`cli/index.ts ${step}( |$)`)) throw new ApiError(409, 'already_running', `${step} 已经在运行`)
    detached('nice', ['-n', '10', 'npm', 'run', '--silent', 'crawler', '--', step], join(this.logDir, `run-${step}.log`))
  }

  /** 跑一遍每日任务（可以只跑其中几步）；和定时任务共用一把锁，已经在跑时不会重复启动 */
  async runDaily(steps: string[] = []): Promise<void> {
    if (await processRunning('scripts/daily.sh')) throw new ApiError(409, 'already_running', '每日任务正在运行，等它结束后再试')
    detached('nice', ['-n', '10', 'flock', '-n', '/tmp/mcpfield-daily.lock', './scripts/daily.sh'], join(this.logDir, 'daily.log'), {
      ...(steps.length ? { STEPS: steps.join(' ') } : {}),
      TRIGGER: 'manual',
    })
  }

  /** 读日志文件最后若干行（只读末尾一段，不把整个文件读进内存） */
  async tail(name: 'daily' | RunnableStep, lines: number): Promise<{ file: string; lines: string[]; size: number; updatedAt: string | null }> {
    const file = name === 'daily' ? 'daily.log' : `run-${name}.log`
    const path = join(this.logDir, file)
    let info
    try {
      info = await stat(path)
    } catch {
      return { file, lines: [], size: 0, updatedAt: null }
    }
    const bytes = Math.min(info.size, Math.max(64 * 1024, lines * 400))
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      await handle.read(buffer, 0, bytes, info.size - bytes)
      const text = buffer.toString('utf8').split('\n')
      // 从中间截断的第一行不完整，去掉
      if (bytes < info.size) text.shift()
      return { file, lines: text.filter(Boolean).slice(-lines), size: info.size, updatedAt: info.mtime.toISOString() }
    } finally {
      await handle.close()
    }
  }
}
