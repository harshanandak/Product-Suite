import type { Sql } from '@product-suite/db'

import { meetingTenantIdsFor, type MeetingTenantMap } from './tenant-map'

/**
 * How far a promoted meeting action item has travelled toward the board.
 *
 * `dismissed` is not in the original task spec, which named three states. It is
 * here because the data genuinely has that case: a human who rejects a proposal
 * has decided something, and showing their rejected candidate as
 * `proposal_pending` would report the opposite of their decision back to them.
 */
export type MeetingPromotionState =
  | 'unpromoted'
  | 'proposal_pending'
  | 'accepted'
  | 'dismissed'

/** One `action_items` row joined to its ledger entry, proposal, and work item. */
export interface MeetingCandidateJoinRow {
  id: string
  meeting_id: string
  text: string
  confidence: number | null
  promotion_reason: string | null
  created_at: string | Date
  proposal_id: string | null
  proposal_status: string | null
  work_item_id: string | null
}

/** What the triage screen consumes. `proposal_status` stays server-side. */
export interface MeetingCandidate {
  id: string
  meeting_id: string
  text: string
  confidence: number | null
  promotion_reason: string | null
  created_at: string | Date
  promotion_state: MeetingPromotionState
  proposal_id: string | null
  work_item_id: string | null
}

export interface ListMeetingCandidatesCtx {
  /** The ONE platform tenant this read is scoped to (the ledger's tenant). */
  tenantId: string
  tenantMap: MeetingTenantMap
}

/** Proposal statuses that mean "the human has finished with this, and said no". */
const DISMISSED_STATUSES = new Set(['rejected', 'superseded', 'expired', 'failed'])

/**
 * Derive the state to show, preferring what was WRITTEN over what was intended:
 * an existing work item is proof the candidate reached the board, whatever the
 * proposal's status column happens to say.
 */
export function derivePromotionState(row: MeetingCandidateJoinRow): MeetingPromotionState {
  if (row.work_item_id !== null) return 'accepted'
  if (row.proposal_id === null) return 'unpromoted'
  if (row.proposal_status !== null && DISMISSED_STATUSES.has(row.proposal_status)) {
    return 'dismissed'
  }
  return 'proposal_pending'
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * The promoted action items for one platform tenant, each with its true promotion
 * state — the read behind the meeting triage screen.
 *
 * Note the two DIFFERENT tenant keys. `action_items.tenant_id` is the MEETING
 * tenant, so it is filtered by the allowlist's mapped ids; `meeting_promotions.tenant_id`
 * is the PLATFORM tenant, because that is what the ingest wrote. With the identity
 * allowlist these coincide, but joining on the wrong one would silently show every
 * candidate as unpromoted the moment they diverge.
 */
export async function listMeetingCandidates(
  sql: Sql,
  ctx: ListMeetingCandidatesCtx,
): Promise<MeetingCandidate[]> {
  const meetingTenantIds = meetingTenantIdsFor(ctx.tenantMap, ctx.tenantId)
  // Fail-closed: an unlisted tenant gets no query at all, rather than one whose
  // tenant filter is empty and therefore unscoped.
  if (meetingTenantIds.length === 0) return []

  // $1 is the platform tenant (ledger + work-item scope); the meeting tenant ids
  // follow as their own bound params — the driver-agnostic `in (...)` shape the
  // ingest uses, with no array-type binding.
  const placeholders = meetingTenantIds.map((_, i) => `$${i + 2}`).join(', ')
  const rows = await runQuery<MeetingCandidateJoinRow>(
    sql,
    `select ai.id, ai.meeting_id, ai."text", ai.confidence, ai.promotion_reason,
            ai.created_at, mp.proposal_id, p.status as proposal_status,
            wi.id as work_item_id
     from "action_items" ai
     left join "meeting_promotions" mp
       on mp.meeting_record_id = ai.id and mp.tenant_id = $1
     left join "proposals" p on p.id = mp.proposal_id and p.tenant_id = $1
     left join "work_items" wi
       on wi.applied_from_proposal_id = mp.proposal_id and wi.tenant_id = $1
     where ai.record_origin = 'generated' and ai.review_status = 'promoted'
       and ai.tenant_id in (${placeholders})
     order by ai.created_at desc`,
    [ctx.tenantId, ...meetingTenantIds],
  )

  return rows.map((row) => ({
    id: row.id,
    meeting_id: row.meeting_id,
    text: row.text,
    confidence: row.confidence,
    promotion_reason: row.promotion_reason,
    created_at: row.created_at,
    promotion_state: derivePromotionState(row),
    proposal_id: row.proposal_id,
    work_item_id: row.work_item_id,
  }))
}
