import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: ['./src/db/schema/catalog.ts', './src/db/schema/ingest.ts', './src/db/schema/community.ts'],
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
})
