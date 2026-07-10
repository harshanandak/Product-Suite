import type { Sql } from '@product-suite/db'

import type { AuthClaims } from '@product-suite/contracts'

/**
 * The org ids (tenants) the caller is an *active* member of, resolved from their
 * Clerk identity (`claims.subject`) through the Alembic-owned
 * `user_auth_identities` → `organization_memberships` chain.
 *
 * This is the single tenancy anchor for the workboard: reads filter by it, and
 * every write guards on it (a row is only mutable when its `tenant_id` is in this
 * set), so nothing crosses tenants on the shared DB. Returns `[]` when the caller
 * belongs to no active org — callers MUST treat that as "deny", never "all".
 */
export async function callerTenantIds(sql: Sql, claims: AuthClaims): Promise<string[]> {
  const rows = (await sql`
    select distinct om.tenant_id
    from organization_memberships om
    join user_auth_identities uai on uai.user_id = om.user_id
    where uai.provider = 'clerk'
      and uai.provider_user_id = ${claims.subject}
      and om.status = 'active'
  `) as { tenant_id: string }[]
  return rows.map((row) => row.tenant_id)
}
