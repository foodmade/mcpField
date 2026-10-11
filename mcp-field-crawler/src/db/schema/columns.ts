import { bigint, char, datetime, timestamp, varchar } from 'drizzle-orm/mysql-core'
import type { EntityKind, Locale } from '../../core/types.ts'

/*
 * 全库统一的列约定：
 * - 主键 id BIGINT UNSIGNED AUTO_INCREMENT，外键同类型
 * - 业务时间 DATETIME(3)，一律存 UTC；行的创建/更新时间由数据库自动维护
 * - 枚举类取值用 VARCHAR + TypeScript 联合类型约束，新增取值不需要 ALTER TABLE
 * - 超过索引长度的 URL 另存 SHA-256（*_hash 列）用于唯一约束
 */

export const pk = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey()
export const ref = (name: string) => bigint(name, { mode: 'number', unsigned: true })
export const at = (name: string) => datetime(name, { mode: 'date', fsp: 3 })
export const sha256 = (name: string) => char(name, { length: 64 })

export const kindCol = () => varchar('kind', { length: 16 }).$type<EntityKind>().notNull()
export const localeCol = () => varchar('locale', { length: 8 }).$type<Locale>().notNull()
export const sourceIdCol = (name = 'source_id') => varchar(name, { length: 32 })
/** 这一行数据的来历：source 源站 / generated 生成 / translated 翻译 / manual 人工 / live 实时探测 */
export const originCol = () => varchar('origin', { length: 16 }).notNull().default('source')

export const timestamps = () => ({
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
})
