import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit config for the Neon platform database. `DATABASE_URL` comes from
 * the local gitignored `.env` (dev) or the deploy environment — never committed.
 * `generate` writes SQL migrations to ./migrations; `migrate` applies them.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
