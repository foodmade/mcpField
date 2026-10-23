import { desc, eq } from 'drizzle-orm'
import type { Db } from '../../../db/client.ts'
import { apiKeys } from '../../../db/schema/index.ts'

export interface ApiKeyRow {
  id: number
  userId: string
  name: string
  hintPrefix: string
  hintSuffix: string
  expiresAt: Date | null
  lastUsedAt: Date | null
  lastUsedClient: string | null
  createdAt: Date
}

export type NewApiKey = Omit<ApiKeyRow, 'id' | 'lastUsedAt' | 'lastUsedClient' | 'createdAt'> & { keyHash: string }

export interface ApiKeyRepository {
  /** 某人的全部密钥（含已过期的），最近创建的在前 */
  list(userId: string): Promise<ApiKeyRow[]>
  insert(row: NewApiKey): Promise<ApiKeyRow>
  find(id: number): Promise<ApiKeyRow | null>
  findByHash(keyHash: string): Promise<ApiKeyRow | null>
  rename(id: number, name: string): Promise<void>
  remove(id: number): Promise<void>
  /** 记下最近一次使用的时间和客户端 */
  touch(id: number, at: Date, client: string | null): Promise<void>
}

const COLUMNS = {
  id: apiKeys.id,
  userId: apiKeys.userId,
  name: apiKeys.name,
  hintPrefix: apiKeys.hintPrefix,
  hintSuffix: apiKeys.hintSuffix,
  expiresAt: apiKeys.expiresAt,
  lastUsedAt: apiKeys.lastUsedAt,
  lastUsedClient: apiKeys.lastUsedClient,
  createdAt: apiKeys.createdAt,
}

export class MysqlApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Db) {}

  async list(userId: string): Promise<ApiKeyRow[]> {
    return this.db.select(COLUMNS).from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.id))
  }

  async insert(row: NewApiKey): Promise<ApiKeyRow> {
    const [inserted] = await this.db.insert(apiKeys).values(row).$returningId()
    return (await this.find(inserted!.id))!
  }

  async find(id: number): Promise<ApiKeyRow | null> {
    const [row] = await this.db.select(COLUMNS).from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
    return row ?? null
  }

  async findByHash(keyHash: string): Promise<ApiKeyRow | null> {
    const [row] = await this.db.select(COLUMNS).from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1)
    return row ?? null
  }

  async rename(id: number, name: string): Promise<void> {
    await this.db.update(apiKeys).set({ name }).where(eq(apiKeys.id, id))
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id))
  }

  async touch(id: number, at: Date, client: string | null): Promise<void> {
    await this.db.update(apiKeys).set({ lastUsedAt: at, ...(client ? { lastUsedClient: client } : {}) }).where(eq(apiKeys.id, id))
  }
}
