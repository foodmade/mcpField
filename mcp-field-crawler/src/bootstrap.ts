import { join } from 'node:path'
import type { AppConfig } from './config.ts'
import { SourceRegistry } from './core/registry.ts'
import type { IngestStore } from './core/store.ts'
import { createDb } from './db/client.ts'
import { McpRegistryFactory } from './sources/mcp-registry/index.ts'
import { McpSoFactory } from './sources/mcpso/index.ts'
import { mcpSoDescribeInput } from './sources/mcpso/describe-facts.ts'
import type { FactExtractor } from './describe/runner.ts'
import { FsBlobStore } from './store/blob-store.ts'
import { FileStore } from './store/file-store.ts'
import { MySqlIngestStore } from './store/mysql-store.ts'

/**
 * 组合根：所有具体实现只在这里装配。
 * 新增数据源时，在 sources/ 下实现一个工厂，然后在这里加一行 register。
 */
export function createRegistry(): SourceRegistry {
  return new SourceRegistry().register(new McpSoFactory()).register(new McpRegistryFactory())
}

/** 各数据源的事实整理器（生成 Loop / CLI / Agent 内容用），新增数据源时在这里登记 */
export const FACT_EXTRACTORS: Record<string, FactExtractor> = { mcpso: mcpSoDescribeInput }

export type StoreKind = 'mysql' | 'file'

export function createStore(kind: StoreKind, config: AppConfig): IngestStore {
  if (kind === 'file') return new FileStore(config.dataDir)
  if (!config.databaseUrl) throw new Error('使用 MySQL 存储需要在 .env 中设置 DATABASE_URL')
  const { db, pool } = createDb(config.databaseUrl)
  return new MySqlIngestStore(db, new FsBlobStore(join(config.dataDir, 'blobs')), () => pool.end())
}
