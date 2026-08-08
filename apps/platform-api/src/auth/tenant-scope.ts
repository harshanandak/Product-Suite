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
    order by om.tenant_id
  `) as { tenant_id: string }[]
  return rows.map((row) => row.tenant_id)
}

/**
 * The caller's internal `users.id`, resolved from their Clerk identity
 * (`claims.subject`) through the Alembic-owned `user_auth_identities` mapping.
 *
 * This is the human `actor_id` for provenance (see the actor-provenance design):
 * every human write records *which* user performed it. It resolves from the same
 * `user_auth_identities` row that `callerTenantIds` already joins through — so any
 * caller who passes tenant scoping necessarily has an id here; a `null` return
 * means the Clerk subject maps to no internal user (an unprovisioned/first-login
 * identity), which callers MUST treat as "no attributable actor", never as a
 * silent default.
 */
export async function callerUserId(sql: Sql, claims: AuthClaims): Promise<string | null> {
  const rows = (await sql`
    select uai.user_id
    from user_auth_identities uai
    where uai.provider = 'clerk'
      and uai.provider_user_id = ${claims.subject}
    limit 1
  `) as { user_id: string }[]
  return rows[0]?.user_id ?? null
}
export interface HumanActorContext {
  tenantId: string
  kind: 'human'
  owningDomain: 'identity.user'
  owningId: string
}

/** Resolve a verified Clerk caller to one tenant-scoped stable human actor reference. */
export async function resolveHumanActorContext(
  sql: Sql,
  claims: AuthClaims,
  tenantId: string,
): Promise<HumanActorContext | null> {
  const tenantIds = await callerTenantIds(sql, claims)
  if (!tenantIds.includes(tenantId)) return null
  const userId = await callerUserId(sql, claims)
  if (!userId) return null
  return { tenantId, kind: 'human', owningDomain: 'identity.user', owningId: userId }
}
