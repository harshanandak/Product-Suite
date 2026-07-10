import { createSql, type Sql } from '@product-suite/db'

/**
 * Resolve the raw Neon SQL client from the request environment. The connection
 * string comes from the Workers binding (`c.env`) in production and falls back
 * to `process.env` in tests / node. Never hard-coded — it lives only in the
 * gitignored env / Workers secret.
 */
export function sqlFrom(env: { DATABASE_URL?: string }): Sql {
  const url = env.DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not configured')
  }
  return createSql(url)
}
