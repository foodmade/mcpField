import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: ['./src/db/schema/catalog.ts', './src/db/schema/ingest.ts', './src/db/schema/community.ts', './src/db/schema/admin.ts', './src/db/schema/blog.ts', './src/db/schema/analytics.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
})
