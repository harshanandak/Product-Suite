import type { AuthClaims, MembershipRole } from '@product-suite/contracts'
import { isMembershipRole } from '@product-suite/contracts'
import type { Sql } from '@product-suite/db'

export type Capability = 'read' | 'edit' | 'configure'

const CAPABILITY_MATRIX = {
  viewer: ['read'],
  member: ['read', 'edit'],
  admin: ['read', 'edit', 'configure'],
  owner: ['read', 'edit', 'configure'],
} as const satisfies Record<MembershipRole, readonly Capability[]>

export interface CapabilityContext {
  tenantId: string
  userId: string
  role: MembershipRole
  capabilities: readonly Capability[]
  authoritySource: 'database_membership'
}

export type CapabilityResolution =
  | { ok: true; context: CapabilityContext }
  | { ok: false; reason: 'not_found' }

export type CapabilityAuthorization =
  | { ok: true; context: CapabilityContext }
  | { ok: false; reason: 'not_found'; status: 404 }
  | { ok: false; reason: 'forbidden'; status: 403 }

interface MembershipRow {
  user_id: unknown
  tenant_id: unknown
  role: unknown
  status: unknown
}

export function capabilitiesForRole(role: MembershipRole): readonly Capability[] {
  return CAPABILITY_MATRIX[role]
}

export function hasCapability(
  context: { capabilities: readonly Capability[] },
  capability: Capability,
): boolean {
  return context.capabilities.includes(capability)
}

/** Resolve authority only from the verified external identity and database membership. */
export async function resolveCapabilityContext(
  sql: Sql,
  claims: AuthClaims,
  requestedTenantId: string,
): Promise<CapabilityResolution> {
  if (!claims.provider || !claims.subject || !requestedTenantId) {
    return { ok: false, reason: 'not_found' }
  }

  const rows = (await sql`
    select uai.user_id, om.tenant_id, om.role, om.status
    from user_auth_identities uai
    join organization_memberships om on om.user_id = uai.user_id
    where uai.provider = ${claims.provider}
      and uai.provider_user_id = ${claims.subject}
      and om.tenant_id = ${requestedTenantId}
    order by uai.user_id, om.id
  `) as MembershipRow[]

  if (rows.length !== 1) return { ok: false, reason: 'not_found' }
  const membership = rows[0]
  if (
    !membership
    || membership.status !== 'active'
    || membership.tenant_id !== requestedTenantId
    || typeof membership.user_id !== 'string'
    || !membership.user_id
    || !isMembershipRole(membership.role)
  ) {
    return { ok: false, reason: 'not_found' }
  }

  return {
    ok: true,
    context: {
      tenantId: requestedTenantId,
      userId: membership.user_id,
      role: membership.role,
      capabilities: capabilitiesForRole(membership.role),
      authoritySource: 'database_membership',
    },
  }
}

export async function authorizeCapability(
  sql: Sql,
  claims: AuthClaims,
  requestedTenantId: string,
  required: Capability,
): Promise<CapabilityAuthorization> {
  const resolution = await resolveCapabilityContext(sql, claims, requestedTenantId)
  if (!resolution.ok) return { ok: false, reason: 'not_found', status: 404 }
  if (!hasCapability(resolution.context, required)) {
    return { ok: false, reason: 'forbidden', status: 403 }
  }
  return resolution
}
