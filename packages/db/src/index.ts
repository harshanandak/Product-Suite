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
