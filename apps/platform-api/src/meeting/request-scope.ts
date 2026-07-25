import { parseMeetingTenantMap, type MeetingTenantMap } from './tenant-map'

/**
 * The org-anchoring and configuration reading shared by the two meeting routes
 * (ingest + candidates). Both must agree exactly on which tenant a request acts
 * for — if they drifted, the triage screen would list one tenant's candidates
 * while "Sync now" ingested another's.
 */

export type MeetingAnchor =
  | { ok: true; tenantId: string }
  | { ok: false; status: 400 | 403 }

/**
 * Resolve the single org a meeting request anchors to. A requested org the caller
 * does NOT belong to is a 403 (a cross-tenant attempt, not an ambiguity); a
 * multi-org caller who names none is a 400 they can fix by naming one.
 */
export function resolveMeetingAnchor(
  tenantIds: string[],
  orgId: string | undefined,
): MeetingAnchor {
  if (tenantIds.length === 0) return { ok: false, status: 403 }
  if (orgId !== undefined) {
    return tenantIds.includes(orgId) ? { ok: true, tenantId: orgId } : { ok: false, status: 403 }
  }
  if (tenantIds.length === 1) return { ok: true, tenantId: tenantIds[0]! }
  return { ok: false, status: 400 }
}

/** The configured tenant allowlist, from the Workers binding or `process.env`. */
export function meetingTenantMapFrom(env: { MEETING_TENANT_MAP?: string }): MeetingTenantMap {
  return parseMeetingTenantMap(env.MEETING_TENANT_MAP ?? process.env.MEETING_TENANT_MAP)
}
