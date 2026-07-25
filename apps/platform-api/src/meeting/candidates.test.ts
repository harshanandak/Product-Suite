import { describe, expect, it, vi } from 'vitest'

import type { Sql } from '@product-suite/db'

import {
  derivePromotionState,
  listMeetingCandidates,
  type MeetingCandidateJoinRow,
} from './candidates'
import { parseMeetingTenantMap } from './tenant-map'

const PLATFORM_TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_PLATFORM_TENANT = '22222222-2222-4222-8222-222222222222'

const TENANT_MAP = parseMeetingTenantMap(
  JSON.stringify({
    tenant_meeting_pilot: PLATFORM_TENANT,
    tenant_meeting_other: OTHER_PLATFORM_TENANT,
  }),
)

function joinRow(overrides: Partial<MeetingCandidateJoinRow> = {}): MeetingCandidateJoinRow {
  return {
    id: 'ai_1',
    meeting_id: 'mtg_1',
    text: 'Send the revised quote to Acme by Friday',
    confidence: 0.82,
    promotion_reason: 'Explicit commitment with a named owner',
    created_at: '2026-07-25T00:00:00.000Z',
    proposal_id: null,
    proposal_status: null,
    work_item_id: null,
    ...overrides,
  }
}

function harness(rows: MeetingCandidateJoinRow[]) {
  const query = vi.fn(async () => rows)
  const sql = { query } as unknown as Sql
  return { sql, query }
}

describe('derivePromotionState', () => {
  it('is unpromoted when no ledger row exists', () => {
    expect(derivePromotionState(joinRow())).toBe('unpromoted')
  })

  it('is proposal_pending while the proposal is still awaiting a human', () => {
    expect(
      derivePromotionState(joinRow({ proposal_id: 'p1', proposal_status: 'pending' })),
    ).toBe('proposal_pending')
  })

  it('is accepted once a work item exists for the proposal', () => {
    expect(
      derivePromotionState(
        joinRow({ proposal_id: 'p1', proposal_status: 'applied', work_item_id: 'wi1' }),
      ),
    ).toBe('accepted')
  })

  it('is dismissed when the human rejected it — never reported as still pending', () => {
    // A rejected candidate is a real outcome. Rendering it as "proposal pending"
    // would tell the reviewer something untrue about their own decision.
    for (const status of ['rejected', 'superseded', 'expired', 'failed']) {
      expect(derivePromotionState(joinRow({ proposal_id: 'p1', proposal_status: status }))).toBe(
        'dismissed',
      )
    }
  })

  it('prefers the work item over the proposal status — the write is the ground truth', () => {
    // An accepted-then-flipped proposal whose row exists IS on the board; the
    // work item is what the reviewer can click through to.
    expect(
      derivePromotionState(
        joinRow({ proposal_id: 'p1', proposal_status: 'accepted', work_item_id: 'wi1' }),
      ),
    ).toBe('accepted')
  })
})

describe('listMeetingCandidates', () => {
  it('reads only generated + promoted rows for the mapped tenants', async () => {
    const { sql, query } = harness([joinRow()])

    await listMeetingCandidates(sql, { tenantId: PLATFORM_TENANT, tenantMap: TENANT_MAP })

    const [text, params] = query.mock.calls[0]! as unknown as [string, unknown[]]
    expect(text).toMatch(/record_origin\s*=\s*'generated'/i)
    expect(text).toMatch(/review_status\s*=\s*'promoted'/i)
    expect(text).toMatch(/from "action_items"/i)
    // Scoped to the meeting tenants mapped to THIS platform tenant, and the ledger
    // join is keyed on the PLATFORM tenant (which is what the ingest wrote).
    expect(params).toContain('tenant_meeting_pilot')
    expect(params).toContain(PLATFORM_TENANT)
    expect(params).not.toContain('tenant_meeting_other')
  })

  it('joins the ledger, its proposal, and the resulting work item', async () => {
    const { sql, query } = harness([joinRow()])

    await listMeetingCandidates(sql, { tenantId: PLATFORM_TENANT, tenantMap: TENANT_MAP })

    const [text] = query.mock.calls[0]! as unknown as [string, unknown[]]
    expect(text).toMatch(/join "meeting_promotions"/i)
    expect(text).toMatch(/join "proposals"/i)
    expect(text).toMatch(/join "work_items"/i)
    expect(text).toMatch(/applied_from_proposal_id/i)
  })

  it('projects each row to the client shape with its derived state', async () => {
    const { sql } = harness([
      joinRow({ id: 'ai_new' }),
      joinRow({ id: 'ai_pending', proposal_id: 'p1', proposal_status: 'pending' }),
      joinRow({
        id: 'ai_done',
        proposal_id: 'p2',
        proposal_status: 'applied',
        work_item_id: 'wi_2',
      }),
    ])

    const result = await listMeetingCandidates(sql, {
      tenantId: PLATFORM_TENANT,
      tenantMap: TENANT_MAP,
    })

    expect(result).toEqual([
      {
        id: 'ai_new',
        meeting_id: 'mtg_1',
        text: 'Send the revised quote to Acme by Friday',
        confidence: 0.82,
        promotion_reason: 'Explicit commitment with a named owner',
        created_at: '2026-07-25T00:00:00.000Z',
        promotion_state: 'unpromoted',
        proposal_id: null,
        work_item_id: null,
      },
      expect.objectContaining({
        id: 'ai_pending',
        promotion_state: 'proposal_pending',
        proposal_id: 'p1',
        work_item_id: null,
      }),
      expect.objectContaining({
        id: 'ai_done',
        promotion_state: 'accepted',
        proposal_id: 'p2',
        work_item_id: 'wi_2',
      }),
    ])
    // `proposal_status` is an internal join column, not part of the client contract.
    expect(result[0]).not.toHaveProperty('proposal_status')
  })

  it('returns nothing at all — and touches no table — for an unlisted tenant', async () => {
    const { sql, query } = harness([joinRow()])

    const result = await listMeetingCandidates(sql, {
      tenantId: 'tenant_not_in_the_allowlist',
      tenantMap: TENANT_MAP,
    })

    expect(result).toEqual([])
    // Fail-closed: no allowed meeting tenant means no query, not an unscoped one.
    expect(query).not.toHaveBeenCalled()
  })
})
