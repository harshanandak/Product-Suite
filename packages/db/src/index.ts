import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'

import * as schema from './schema'

export * from './schema'
export { schema }

/**
 * Create a Drizzle client bound to a Neon (serverless HTTP) connection. The
 * connection string is provided by the caller (Workers binding / env) — never
 * hard-coded. One client per request is cheap over Neon's HTTP driver.
 */
export function createDb(connectionString: string) {
  return drizzle(neon(connectionString), { schema })
}

export type Database = ReturnType<typeof createDb>

/**
 * Raw Neon (serverless HTTP) tagged-template client. Use for queries that span
 * the Drizzle-managed workboard tables AND the Alembic-owned tenancy tables
 * (`organization_memberships`, `user_auth_identities`) — e.g. resolving the
 * caller's tenant scope from their Clerk identity.
 */
export function createSql(connectionString: string) {
  return neon(connectionString)
}

export type Sql = ReturnType<typeof createSql>
