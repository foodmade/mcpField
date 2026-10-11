import { drizzle } from 'drizzle-orm/mysql2'
import { createPool, type Pool } from 'mysql2/promise'
import * as schema from './schema/index.ts'

export type Db = ReturnType<typeof createDb>['db']

export function createDb(url: string): { db: ReturnType<typeof drizzle<typeof schema, Pool>>; pool: Pool } {
  const pool = createPool({ uri: url, connectionLimit: 8, charset: 'utf8mb4', timezone: 'Z' })
  return { db: drizzle({ client: pool, schema, mode: 'default' }), pool }
}
