/**
 * Meeting → platform tenant mapping.
 *
 * Meeting API keys its rows by a TEXT tenant id of its own; the platform keys
 * everything by a uuid `tenant_id`. Nothing derives one from the other, so the
 * correspondence is explicit configuration: a JSON object of
 * `{ "<meeting text tenant id>": "<platform uuid tenant id>" }`.
 *
 * FAIL-CLOSED, deliberately. An unmapped meeting tenant is refused — there is no
 * default, no passthrough, and specifically no "there is only one tenant, so it
 * must be that one" fallback. That fallback is the failure mode worth designing
 * against: it turns a configuration gap into one company's action items appearing
 * on another company's board, silently and after the fact. Refusing is visible
 * (the ingest reports the skipped count) and reversible; mis-filing is neither.
 *
 * Parsing NEVER throws. A typo in a Workers secret must degrade to "ingest
 * proposes nothing", not to an API that fails to boot.
 */

/** meeting TEXT tenant id → platform uuid tenant id. */
export type MeetingTenantMap = ReadonlyMap<string, string>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Parse the configured mapping. Anything that is not a JSON object yields an
 * empty map (which refuses everything); an individual entry that is not
 * `non-empty text id → uuid` is dropped rather than trusted.
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
    if (typeof platformTenantId !== 'string' || !UUID_RE.test(platformTenantId)) continue
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
