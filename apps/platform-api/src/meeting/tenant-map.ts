/**
 * Meeting → platform tenant mapping, configured as a JSON object of
 * `{ "<meeting tenant id>": "<platform tenant id>" }`.
 *
 * The meeting tables live in the SAME `public` schema as the board and already
 * share `public.tenants`, so in practice this map is near-identity. Its real job
 * is therefore an **allowlist**: which tenants have opted into having their
 * promoted meeting action items proposed onto their board. Identity is the
 * expected configuration, not a degenerate case — and keeping the indirection
 * means enabling a tenant stays a config change, not a code change.
 *
 * FAIL-CLOSED, deliberately. An unlisted tenant is refused — no default, no
 * passthrough, and specifically no "there is only one tenant, so it must be that
 * one" fallback. That fallback turns a configuration gap into one company's action
 * items appearing on another company's board, silently and after the fact.
 * Refusing is visible (the ingest reports the skipped count) and reversible;
 * mis-filing is neither.
 *
 * BOTH sides are free-form TEXT and neither may be validated as a uuid:
 * `public.tenants.id` holds a mix of uuids and Clerk org ids (`org_…`) in the live
 * database, so a uuid check would refuse a real tenant.
 *
 * Parsing NEVER throws. A typo in a Workers secret must degrade to "ingest
 * proposes nothing", not to an API that fails to boot.
 */

/** meeting tenant id → platform tenant id (both TEXT, and usually identical). */
export type MeetingTenantMap = ReadonlyMap<string, string>

/**
 * Parse the configured mapping. Anything that is not a JSON object yields an
 * empty map (which refuses everything); an individual entry that is not
 * `non-empty text id → non-empty text id` is dropped rather than trusted.
 */
export function parseMeetingTenantMap(raw: string | undefined | null): MeetingTenantMap {
  const map = new Map<string, string>()
  if (typeof raw !== 'string' || raw.trim() === '') return map

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return map
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return map

  for (const [meetingTenantId, platformTenantId] of Object.entries(parsed)) {
    if (meetingTenantId.trim() === '') continue
    if (typeof platformTenantId !== 'string' || platformTenantId.trim() === '') continue
    map.set(meetingTenantId, platformTenantId)
  }
  return map
}

/** The platform tenant a meeting tenant belongs to, or `null` when unmapped. */
export function resolvePlatformTenantId(
  map: MeetingTenantMap,
  meetingTenantId: string,
): string | null {
  return map.get(meetingTenantId) ?? null
}

/** Every meeting tenant mapped to a given platform tenant (usually exactly one). */
export function meetingTenantIdsFor(map: MeetingTenantMap, platformTenantId: string): string[] {
  const out: string[] = []
  for (const [meetingTenantId, mapped] of map) {
    if (mapped === platformTenantId) out.push(meetingTenantId)
  }
  return out
}
