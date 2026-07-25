import { describe, expect, it } from 'vitest'

import { meetingTenantIdsFor, parseMeetingTenantMap, resolvePlatformTenantId } from './tenant-map'

const PLATFORM_A = '11111111-1111-4111-8111-111111111111'
const PLATFORM_B = '22222222-2222-4222-8222-222222222222'
/** The live `public.tenants` table holds Clerk org ids alongside uuids. */
const PLATFORM_CLERK = 'org_3GjXPnun3ZpummWvuvNS2vnXwFf'

describe('parseMeetingTenantMap', () => {
  it('maps a configured meeting tenant id to its platform tenant id', () => {
    const map = parseMeetingTenantMap(
      JSON.stringify({ tenant_meeting_pilot: PLATFORM_A, tenant_meeting_two: PLATFORM_B }),
    )

    expect(resolvePlatformTenantId(map, 'tenant_meeting_pilot')).toBe(PLATFORM_A)
    expect(resolvePlatformTenantId(map, 'tenant_meeting_two')).toBe(PLATFORM_B)
    expect(meetingTenantIdsFor(map, PLATFORM_A)).toEqual(['tenant_meeting_pilot'])
  })

  it('accepts the identity mapping and Clerk org ids — the real production shapes', () => {
    // Meeting rows and the board already share `public.tenants`, so the configured
    // map is normally identity; and `tenants.id` is TEXT holding uuids AND Clerk org
    // ids, so validating either side as a uuid would refuse a real tenant.
    const map = parseMeetingTenantMap(
      JSON.stringify({ [PLATFORM_CLERK]: PLATFORM_CLERK, [PLATFORM_A]: PLATFORM_A }),
    )

    expect(resolvePlatformTenantId(map, PLATFORM_CLERK)).toBe(PLATFORM_CLERK)
    expect(meetingTenantIdsFor(map, PLATFORM_CLERK)).toEqual([PLATFORM_CLERK])
    expect(resolvePlatformTenantId(map, PLATFORM_A)).toBe(PLATFORM_A)
    // Identity is an ALLOWLIST, not a passthrough: a tenant that is not listed is
    // still refused even though the mapping would have been trivial.
    expect(resolvePlatformTenantId(map, PLATFORM_B)).toBeNull()
  })

  it('refuses an unmapped meeting tenant — fail-closed, with no "only tenant" fallback', () => {
    // Exactly ONE configured entry: the tempting shortcut is to treat it as the
    // default for anything unrecognised. That would silently file another
    // company's action items into this tenant's board.
    const map = parseMeetingTenantMap(JSON.stringify({ tenant_meeting_pilot: PLATFORM_A }))

    expect(map.size).toBe(1)
    expect(resolvePlatformTenantId(map, 'tenant_meeting_unknown')).toBeNull()
    expect(resolvePlatformTenantId(map, '')).toBeNull()
    expect(resolvePlatformTenantId(map, 'TENANT_MEETING_PILOT')).toBeNull()
    expect(meetingTenantIdsFor(map, PLATFORM_B)).toEqual([])
  })

  it('yields an empty map that refuses everything for a malformed or absent configuration', () => {
    for (const raw of [
      undefined,
      null,
      '',
      '   ',
      'not json at all',
      '[]', // a JSON array is not a tenant map
      '"tenant_meeting_pilot"',
      'null',
      '42',
    ]) {
      // Never throws at import/parse time — an operator typo must not take the API down.
      const map = parseMeetingTenantMap(raw)
      expect(map.size).toBe(0)
      expect(resolvePlatformTenantId(map, 'tenant_meeting_pilot')).toBeNull()
    }
  })

  it('drops entries whose either side is not a non-empty text id', () => {
    const map = parseMeetingTenantMap(
      JSON.stringify({
        tenant_meeting_pilot: PLATFORM_A,
        tenant_meeting_empty: '',
        tenant_meeting_blank: '   ',
        tenant_meeting_wrong_type: 42,
        tenant_meeting_null: null,
        '': PLATFORM_B,
      }),
    )

    expect([...map.keys()]).toEqual(['tenant_meeting_pilot'])
    expect(resolvePlatformTenantId(map, 'tenant_meeting_empty')).toBeNull()
    expect(resolvePlatformTenantId(map, 'tenant_meeting_blank')).toBeNull()
    expect(resolvePlatformTenantId(map, 'tenant_meeting_wrong_type')).toBeNull()
    expect(resolvePlatformTenantId(map, 'tenant_meeting_null')).toBeNull()
  })
})
