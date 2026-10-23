import { createHash, randomInt } from 'node:crypto'
import type { AuthUser } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import type { ApiKeyRepository, ApiKeyRow } from './key.repository.ts'

/** 密钥格式：mf_ 加 36 位大小写字母和数字（约 214 位随机性） */
export const KEY_PREFIX = 'mf_'
const KEY_BODY = 36
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}[A-Za-z0-9]{${KEY_BODY}}$`)

/** 每人最多的有效密钥数（已过期的不算） */
export const KEYS_MAX = 10
export const NAME_MAX = 40
/** 可选的有效期（天）；null 表示永不过期 */
export const EXPIRY_DAYS = [30, 90, 365, null] as const
/** 每个密钥每分钟最多的调用次数 */
const RATE_MAX = 60
const RATE_WINDOW = 60_000
/** 最近使用时间最多 5 分钟写一次库（客户端换了时立即写） */
const TOUCH_GAP = 5 * 60_000

export interface ApiKeyDto {
  id: string
  name: string
  /** 列表里显示的样子：mf_8KQ2••••x7Pa */
  hint: string
  createdAt: string
  expiresAt: string | null
  expired: boolean
  lastUsedAt: string | null
  lastUsedClient: string | null
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

function generateKey(): string {
  let body = ''
  for (let i = 0; i < KEY_BODY; i++) body += ALPHABET[randomInt(ALPHABET.length)]
  return KEY_PREFIX + body
}

function cleanName(name: string): string {
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value) throw ApiError.badRequest('请填写密钥名称')
  if ([...value].length > NAME_MAX) throw ApiError.badRequest(`名称最多 ${NAME_MAX} 字`)
  return value
}

/** 客户端名称：只留常见字符，最长 64 */
const cleanClient = (client: string | undefined) => client?.replace(/[^\w .@/+-]/g, '').trim().slice(0, 64) || null

/** API 密钥：网站账号管理自己的密钥；MCP 服务带着密钥调用收藏接口时，在这里换成对应的账号 */
export class ApiKeyService {
  private readonly usage = new Map<number, { windowStart: number; count: number; touchedAt: number; client: string | null }>()

  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private isExpired(row: ApiKeyRow) {
    return !!row.expiresAt && row.expiresAt.getTime() <= this.now()
  }

  private toDto(row: ApiKeyRow): ApiKeyDto {
    return {
      id: String(row.id),
      name: row.name,
      hint: `${KEY_PREFIX}${row.hintPrefix}••••${row.hintSuffix}`,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      expired: this.isExpired(row),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastUsedClient: row.lastUsedClient,
    }
  }

  private async own(user: AuthUser, id: number): Promise<ApiKeyRow> {
    const row = await this.repository.find(id)
    if (!row || row.userId !== user.id) throw ApiError.notFound('密钥不存在')
    return row
  }

  async list(user: AuthUser): Promise<ApiKeyDto[]> {
    return (await this.repository.list(user.id)).map((r) => this.toDto(r))
  }

  /** 创建密钥：完整密钥只在这里返回一次 */
  async create(user: AuthUser, input: { name: string; expiresInDays: (typeof EXPIRY_DAYS)[number] }): Promise<{ key: string; item: ApiKeyDto }> {
    const name = cleanName(input.name)
    const active = (await this.repository.list(user.id)).filter((r) => !this.isExpired(r)).length
    if (active >= KEYS_MAX) throw new ApiError(400, 'limit_reached', `最多 ${KEYS_MAX} 个有效密钥，请先撤销不用的`)
    const key = generateKey()
    const body = key.slice(KEY_PREFIX.length)
    const row = await this.repository.insert({
      userId: user.id,
      name,
      keyHash: hashKey(key),
      hintPrefix: body.slice(0, 4),
      hintSuffix: body.slice(-4),
      expiresAt: input.expiresInDays === null ? null : new Date(this.now() + input.expiresInDays * 86_400_000),
    })
    return { key, item: this.toDto(row) }
  }

  async rename(user: AuthUser, id: number, name: string): Promise<ApiKeyDto> {
    const row = await this.own(user, id)
    const value = cleanName(name)
    await this.repository.rename(id, value)
    return this.toDto({ ...row, name: value })
  }

  /** 撤销（删除）；过期的密钥也用它删 */
  async remove(user: AuthUser, id: number): Promise<void> {
    await this.own(user, id)
    await this.repository.remove(id)
    this.usage.delete(id)
  }

  /**
   * 用密钥换账号：格式不对、不存在（含已撤销）、已过期都拒绝；每个密钥每分钟最多 60 次。
   * client 是 MCP 服务转来的客户端名称，和使用时间一起记下（5 分钟内最多写一次库）。
   */
  async authenticate(key: string, client?: string): Promise<AuthUser> {
    if (!KEY_PATTERN.test(key)) throw new ApiError(401, 'invalid_api_key', 'API 密钥无效或已撤销')
    const row = await this.repository.findByHash(hashKey(key))
    if (!row) throw new ApiError(401, 'invalid_api_key', 'API 密钥无效或已撤销')
    if (this.isExpired(row)) throw new ApiError(401, 'api_key_expired', 'API 密钥已过期，请在控制台创建新的密钥')

    const now = this.now()
    const name = cleanClient(client)
    const use = this.usage.get(row.id) ?? { windowStart: now, count: 0, touchedAt: row.lastUsedAt?.getTime() ?? 0, client: row.lastUsedClient }
    if (now - use.windowStart >= RATE_WINDOW) {
      use.windowStart = now
      use.count = 0
    }
    if (use.count >= RATE_MAX) throw new ApiError(429, 'rate_limited', '请求太频繁，请稍后再试')
    use.count++
    if (now - use.touchedAt >= TOUCH_GAP || (name && name !== use.client)) {
      use.touchedAt = now
      use.client = name ?? use.client
      await this.repository.touch(row.id, new Date(now), name)
    }
    this.usage.set(row.id, use)
    return { id: row.userId, name: row.name, avatar: null }
  }
}
