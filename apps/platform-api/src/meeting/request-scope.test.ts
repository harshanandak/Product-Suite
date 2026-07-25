import { describe, expect, it } from 'vitest'

import { meetingTenantMapFrom, resolveMeetingAnchor } from './request-scope'

describe('resolveMeetingAnchor', () => {
  it('anchors a single-org caller who names no org to that org', () => {
    expect(resolveMeetingAnchor(['t1'], undefined)).toEqual({ ok: true, tenantId: 't1' })
  })

  it('anchors to the named org when the caller belongs to it', () => {
    expect(resolveMeetingAnchor(['t1', 't2'], 't2')).toEqual({
      ok: true,
      tenantId: 't2',
    })
  })

  it('refuses an org the caller does not belong to with 403, not 400', () => {
    // A cross-tenant attempt is a refusal, NOT an ambiguity the caller can fix by
    // asking again — answering 400 would invite them to retry naming other orgs.
    expect(resolveMeetingAnchor(['t1'], 't2')).toEqual({ ok: false, status: 403 })
  })

  it('refuses a caller with no orgs at all with 403', () => {
    expect(resolveMeetingAnchor([], undefined)).toEqual({ ok: false, status: 403 })
    expect(resolveMeetingAnchor([], 't1')).toEqual({ ok: false, status: 403 })
  })

  it('asks a multi-org caller who names none to pick, with 400', () => {
    expect(resolveMeetingAnchor(['t1', 't2'], undefined)).toEqual({
      ok: false,
      status: 400,
    })
  })

  it('never anchors on an empty-string org id by treating it as unnamed', () => {
    // `''` is a named org the caller does not belong to — refused, never silently
    // collapsed to "they named nothing" and anchored to their only tenant.
    expect(resolveMeetingAnchor(['t1'], '')).toEqual({ ok: false, status: 403 })
  })
})

describe('meetingTenantMapFrom', () => {
  it('reads the allowlist from the Workers binding', () => {
    const map = meetingTenantMapFrom({
      MEETING_TENANT_MAP: JSON.stringify({ mt1: 'pt1' }),
    })
    expect(map.get('mt1')).toBe('pt1')
  })

  it('falls back to process.env when the binding is absent', () => {
    const previous = process.env.MEETING_TENANT_MAP
    process.env.MEETING_TENANT_MAP = JSON.stringify({ mt2: 'pt2' })
    try {
      expect(meetingTenantMapFrom({}).get('mt2')).toBe('pt2')
    } finally {
      if (previous === undefined) delete process.env.MEETING_TENANT_MAP
      else process.env.MEETING_TENANT_MAP = previous
    }
  })

  it('yields an empty map that refuses everything when nothing is configured', () => {
    const previous = process.env.MEETING_TENANT_MAP
    delete process.env.MEETING_TENANT_MAP
    try {
      // Fail-closed: no configuration means no tenant is allowlisted, rather than
      // every tenant being ingested by default.
      expect(meetingTenantMapFrom({}).size).toBe(0)
    } finally {
      if (previous !== undefined) process.env.MEETING_TENANT_MAP = previous
    }
  })
})
