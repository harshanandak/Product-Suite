import { describe, expect, it } from 'vitest'

import { meetingTenantIdsFor, parseMeetingTenantMap, resolvePlatformTenantId } from './tenant-map'

const PLATFORM_A = '11111111-1111-4111-8111-111111111111'
const PLATFORM_B = '22222222-2222-4222-8222-222222222222'

describe('parseMeetingTenantMap', () => {
  it('maps a configured meeting TEXT tenant id to its platform uuid tenant id', () => {
    const map = parseMeetingTenantMap(
      JSON.stringify({ tenant_meeting_pilot: PLATFORM_A, tenant_meeting_two: PLATFORM_B }),
    )

    expect(resolvePlatformTenantId(map, 'tenant_meeting_pilot')).toBe(PLATFORM_A)
    expect(resolvePlatformTenantId(map, 'tenant_meeting_two')).toBe(PLATFORM_B)
    expect(meetingTenantIdsFor(map, PLATFORM_A)).toEqual(['tenant_meeting_pilot'])
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

  it('drops individual entries that are not meeting-text-id → platform-uuid', () => {
    const map = parseMeetingTenantMap(
      JSON.stringify({
        tenant_meeting_pilot: PLATFORM_A,
        tenant_meeting_bad: 'not-a-uuid',
        tenant_meeting_empty: '',
        '': PLATFORM_B,
      }),
    )

    expect([...map.keys()]).toEqual(['tenant_meeting_pilot'])
    expect(resolvePlatformTenantId(map, 'tenant_meeting_bad')).toBeNull()
    expect(resolvePlatformTenantId(map, 'tenant_meeting_empty')).toBeNull()
  })
})
