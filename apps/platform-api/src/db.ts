import { createSql, type Sql } from '@product-suite/db'

const RUNTIME_NEON_HOST = /^ep-([a-z0-9-]+?)(-pooler)?\.[a-z0-9-]+\.aws\.neon\.tech$/i
export const CANONICAL_DATABASE = 'neondb'
export const CANONICAL_SCHEMA = 'public'
export const CANONICAL_REVISION = '0021_command_kernel'
export const CANONICAL_REVISION_HASH = '2042bfff093e75f5f8ae1c09ae6a6ddfee026fce24403be6f110d1560504f724'

export interface RuntimeNeonUrl {
  provider: 'neon'
  database: typeof CANONICAL_DATABASE
  schema: typeof CANONICAL_SCHEMA
  /** Neon connection hosts expose an endpoint id, not project/branch ids. */
  endpointId: string
  pooled: true
}

/**
 * Validate the application boundary: runtime traffic must use a pooled Neon
 * URL for the canonical database. Errors are codes only; URL/user/password
 * material never appears in an exception.
 */
export function parseRuntimeNeonUrl(value: string): RuntimeNeonUrl {
  if (typeof value !== 'string' || value.length === 0) throw new Error('DATABASE_URL_INVALID')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('DATABASE_URL_INVALID')
  }

  const host = RUNTIME_NEON_HOST.exec(url.hostname)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host || !host[2]) {
    throw new Error('DATABASE_PROVIDER_INVALID')
  }
  if (url.pathname !== `/${CANONICAL_DATABASE}`) throw new Error('DATABASE_NAME_INVALID')
  if (!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')) {
    throw new Error('DATABASE_TLS_REQUIRED')
  }

  return {
    provider: 'neon',
    database: CANONICAL_DATABASE,
    schema: CANONICAL_SCHEMA,
    endpointId: host[1]!,
    pooled: true,
  }
}

export type DatabaseReadiness =
  | { ok: true; provider: 'neon'; schema: typeof CANONICAL_SCHEMA; revision: typeof CANONICAL_REVISION }
  | { ok: false; code: 'DATABASE_URL_NOT_CONFIGURED' | 'DATABASE_NOT_READY' | 'DATABASE_REVISION_NOT_READY' | 'DATABASE_PROVIDER_INVALID' | 'DATABASE_NAME_INVALID' | 'DATABASE_TLS_REQUIRED' | 'DATABASE_URL_INVALID' }

type ReadinessQuery = (sql: Sql) => Promise<unknown>

/**
 * Probe only the canonical migration floor and return an opaque deployment
 * signal. Callers can inject a query in tests; production uses one read-only
 * query against `drizzle.__drizzle_migrations`. Drizzle's canonical journal
 * stores migration hashes, not tags; the checked-in revision hash is the
 * product-owned readiness floor. Later migrations are valid once this hash is
 * present, so readiness is not tied to the newest row.
 */
export async function databaseReadiness(
  env: { DATABASE_URL?: string },
  query?: ReadinessQuery,
): Promise<DatabaseReadiness> {
  const url = env.DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) return { ok: false, code: 'DATABASE_URL_NOT_CONFIGURED' }

  try {
    parseRuntimeNeonUrl(url)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'DATABASE_URL_INVALID'
    if (
      code === 'DATABASE_PROVIDER_INVALID' ||
      code === 'DATABASE_NAME_INVALID' ||
      code === 'DATABASE_TLS_REQUIRED' ||
      code === 'DATABASE_URL_INVALID'
    ) {
      return { ok: false, code }
    }
    return { ok: false, code: 'DATABASE_NOT_READY' }
  }

  try {
    const sql = createSql(url)
    const result = query
      ? await query(sql)
      : await sql`select hash from drizzle.__drizzle_migrations where hash = ${CANONICAL_REVISION_HASH} limit 1`
    const rows = (result as { rows?: unknown[] })?.rows ?? (Array.isArray(result) ? result : [])
    const hasCanonicalRevision = rows.some((row) => (row as { hash?: unknown })?.hash === CANONICAL_REVISION_HASH)
    if (!hasCanonicalRevision) return { ok: false, code: 'DATABASE_REVISION_NOT_READY' }
    return { ok: true, provider: 'neon', schema: CANONICAL_SCHEMA, revision: CANONICAL_REVISION }
  } catch {
    return { ok: false, code: 'DATABASE_NOT_READY' }
  }
}

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
