import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/** 剩余有效期少于这个时间就重新拉取 */
const REFRESH_BEFORE_MS = 15 * 60_000

/** JWT 的过期时间（毫秒） */
export function tokenExpiry(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }
  return (payload.exp ?? 0) * 1000
}

export function tokenFromEnvFile(text: string): string | null {
  return /^VERCEL_OIDC_TOKEN="?([^"\n]+)"?/m.exec(text)?.[1] ?? null
}

/**
 * skills.sh API 用的 Vercel OIDC 令牌。
 * 目录是一个已 `vercel link` 的空项目（不在代码仓库里），令牌在它的 .env.local 里，有效期约 12 小时；
 * 快过期时在该目录运行 `vercel env pull` 换新的（用本机 Vercel CLI 的登录状态），长时间采集也不会中断。
 */
export class VercelOidcToken {
  private token: string | null = null
  private refreshing: Promise<void> | null = null

  constructor(
    private readonly dir: string,
    private readonly pull: (dir: string) => Promise<void> = async (cwd) => {
      await promisify(execFile)('vercel', ['env', 'pull', '.env.local', '--yes'], { cwd, timeout: 120_000 })
    },
  ) {}

  async get(): Promise<string> {
    if (!this.token || tokenExpiry(this.token) - Date.now() < REFRESH_BEFORE_MS) {
      this.refreshing ??= this.load().finally(() => {
        this.refreshing = null
      })
      await this.refreshing
    }
    return this.token!
  }

  private async read(): Promise<string | null> {
    const text = await readFile(join(this.dir, '.env.local'), 'utf8').catch(() => '')
    return tokenFromEnvFile(text)
  }

  private async load(): Promise<void> {
    let token = await this.read()
    if (!token || tokenExpiry(token) - Date.now() < REFRESH_BEFORE_MS) {
      await this.pull(this.dir)
      token = await this.read()
    }
    if (!token) throw new Error(`没有找到 skills.sh 的访问令牌：请在 ${this.dir} 运行 vercel link 和 vercel env pull（见 docs/DESIGN.md）`)
    this.token = token
  }
}
