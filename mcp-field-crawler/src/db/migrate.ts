import { migrate } from 'drizzle-orm/mysql2/migrator'
import { fileURLToPath } from 'node:url'
import { createDb } from './client.ts'

/* 执行 drizzle/ 目录下尚未应用的迁移；出错时打印完整原因（drizzle-kit migrate 只显示进度动画） */

const url = process.env.DATABASE_URL
if (!url) throw new Error('需要在 .env 中设置 DATABASE_URL')

const { db, pool } = createDb(url)
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  console.log('迁移完成')
} catch (error) {
  const cause = (error as { cause?: unknown }).cause
  console.error('迁移失败：', (error as Error).message, cause ? `\n原因：${String(cause)}` : '')
  process.exitCode = 1
} finally {
  await pool.end()
}
