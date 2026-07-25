import type { Sql } from '@product-suite/db'

import { createProposal } from '../proposals/repository'
import { meetingTenantIdsFor, resolvePlatformTenantId, type MeetingTenantMap } from './tenant-map'

/** The provenance stamped on meeting-authored proposals. */
export const MEETING_INGEST_PROMPT_VERSION = 'meeting-ingest-v1'
/** Reserved `agent_runs.triggered_by` sentinel for this job (not a user id). */
export const MEETING_INGEST_TRIGGERED_BY = 'meeting-ingest'

/**
 * A promoted action item, as read from `action_items`.
 *
 * That table lives in the platform `public` schema, NOT in a `meeting` schema:
 * the meeting tables were never moved out of the shared Neon database, and
 * `public.tenants` is already the tenant table both sides reference. The column
 * list below is the live shape, read from `information_schema` rather than from
 * the Alembic history.
 */
export interface MeetingCandidateRow {
  /** meeting-api's CONTENT-DERIVED id — stable across its delete/re-insert reprocess. */
  id: string
  tenant_id: string
  meeting_id: string
  text: string
  confidence: number | null
  promotion_reason: string | null
  evidence_refs: unknown
}

export interface RunMeetingIngestCtx {
  /** The ONE platform tenant this run anchors to (mirrors the reflection run). */
  tenantId: string
  tenantMap: MeetingTenantMap
}

export interface MeetingIngestResult {
  proposalsCreated: number
  /**
   * Candidates this run did not propose because something else already had:
   * a prior run recorded in the ledger, or a concurrent run that won the ledger's
   * unique index (whose loser's proposal is superseded, not counted as created).
   */
  skippedDuplicate: number
  /**
   * Candidates refused by the map re-check — CALLER-SCOPED, counted only over rows
   * this caller's own scope returned. It is not a system-wide figure: see
   * {@link tenantAllowlisted} for the "why did nothing appear" signal.
   */
  skippedUnmappedTenant: number
  /**
   * False when this caller's platform tenant is absent from the meeting tenant
   * allowlist — the honest answer to "why did no proposals appear", and a fact
   * about the caller's OWN configuration, so reporting it reveals nothing about
   * anyone else.
   */
  tenantAllowlisted: boolean
  proposalIds: string[]
  runId: string
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * The proposal payload for a candidate — a pure function, so the mapping is
 * testable apart from the database.
 *
 * `team_id` is deliberately ABSENT (not null, not ''): `apply.ts` resolves the
 * tenant's sole team only when the key is missing, and declines clearly when the
 * tenant has several. A meeting transcript cannot know which team owns the work,
 * so guessing here would put items on the wrong board; letting accept-time
 * resolution handle it keeps that decision where a human can see it.
 *
 * `source: 'meeting'` is a real `work_item_source` enum value and `createWorkItem`
 * persists `input.source`, so an accepted proposal lands a work item that says
 * where it came from.
 */
export function buildProposalPayload(candidate: MeetingCandidateRow): Record<string, unknown> {
  return { title: candidate.text, source: 'meeting' }
}

/** A human-readable "why was this proposed", derived from the candidate's own signals. */
export function buildRationale(candidate: MeetingCandidateRow): string {
  const parts = [`Promoted action item from meeting ${candidate.meeting_id}.`]
  if (candidate.promotion_reason && candidate.promotion_reason.trim() !== '') {
    parts.push(candidate.promotion_reason.trim())
  }
  const evidenceCount = Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs.length : 0
  parts.push(`Confidence ${(candidate.confidence ?? 0).toFixed(2)} from ${evidenceCount} transcript reference(s).`)
  return parts.join(' ')
}

/**
 * Read promoted meeting action items for one platform tenant and turn each new one
 * into a pending proposal — exactly once, ever.
 *
 * Exactly-once is keyed on `meeting_promotions (tenant_id, meeting_record_id)`
 * rather than on anything row-shaped, because meeting-api rematerializes action
 * items by DELETE + re-INSERT: the row is reborn on every reprocess, its
 * content-derived id is not.
 *
 * The ledger read skips records a PRIOR run proposed; the ledger's unique index
 * settles two CONCURRENT runs, and the loser supersedes its own surplus proposal
 * (see `recordPromotion`). Either way the reviewer sees exactly one pending row.
 *
 * Nothing here writes a work item. The proposal goes through the same review queue
 * as every other agent proposal, and a human's accept is what applies it.
 */
export async function runMeetingIngest(
  sql: Sql,
  ctx: RunMeetingIngestCtx,
): Promise<MeetingIngestResult> {
  const allowedMeetingTenantIds = meetingTenantIdsFor(ctx.tenantMap, ctx.tenantId)

  // 1. Mint the run FIRST, unconditionally — one per call whatever the candidate
  //    count, so every ingest attempt is attributable even when it proposes nothing.
  const runRows = await runQuery<{ id: string }>(
    sql,
    `insert into "agent_runs" ("tenant_id", "triggered_by", "kind", "status", "memory_holdout")
     values ($1, '${MEETING_INGEST_TRIGGERED_BY}', 'agent_run', 'running', false) returning id`,
    [ctx.tenantId],
  )
  const runId = runRows[0]!.id

  // 2. A fail-closed map that reports 0 skips is indistinguishable from a
  //    correctly-configured one, so the caller still gets told when its own tenant
  //    is not allowlisted. That is a fact about the CALLER's configuration and
  //    costs no query — unlike counting other tenants' rows, which told the caller
  //    how much promoted work exists outside its scope.
  const tenantAllowlisted = allowedMeetingTenantIds.length > 0

  const result: MeetingIngestResult = {
    proposalsCreated: 0,
    skippedDuplicate: 0,
    skippedUnmappedTenant: 0,
    tenantAllowlisted,
    proposalIds: [],
    runId,
  }

  if (!tenantAllowlisted) {
    console.warn(
      `[meeting-ingest] tenant ${ctx.tenantId} is not in the meeting tenant allowlist — nothing will be proposed`,
    )
  }

  const candidates = tenantAllowlisted ? await readPromotedCandidates(sql, allowedMeetingTenantIds) : []

  if (candidates.length > 0) {
    // Re-check each row against the map even though the read is already scoped —
    // the map is the authority on which tenant a row belongs to, and a query that
    // is one edit away from losing its filter must not become a cross-tenant leak.
    const owned: MeetingCandidateRow[] = []
    for (const candidate of candidates) {
      if (resolvePlatformTenantId(ctx.tenantMap, candidate.tenant_id) === ctx.tenantId) {
        owned.push(candidate)
      } else {
        result.skippedUnmappedTenant += 1
      }
    }

    const alreadyProposed = await readLedger(
      sql,
      ctx.tenantId,
      owned.map((candidate) => candidate.id),
    )

    for (const candidate of owned) {
      if (alreadyProposed.has(candidate.id)) {
        result.skippedDuplicate += 1
        continue
      }
      const proposal = await createProposal(sql, {
        tenant_id: ctx.tenantId,
        run_id: runId,
        target_type: 'work_item',
        operation: 'create',
        payload: buildProposalPayload(candidate),
        rationale: buildRationale(candidate),
        confidence: candidate.confidence,
        prompt_version: MEETING_INGEST_PROMPT_VERSION,
        actor_type: 'agent',
        actor_id: runId,
        context_ref: candidate.id,
      })
      const reserved = await recordPromotion(sql, ctx.tenantId, candidate.id, proposal.id)
      if (!reserved) {
        // A concurrent ingest claimed this record between our ledger read and write.
        // Its proposal is the one the ledger points at, so ours is surplus — latch it
        // out of `pending` rather than leave the reviewer two identical rows.
        await supersedeProposal(sql, proposal.id)
        result.skippedDuplicate += 1
        continue
      }
      result.proposalIds.push(proposal.id)
      result.proposalsCreated += 1
    }
  }

  await runQuery(sql, `update "agent_runs" set status = 'completed' where id = $1`, [runId])
  return result
}

/** The promoted, generated action items belonging to the given meeting tenants.
 *  `text` is quoted — it is both a column name here and a Postgres type name. */
function readPromotedCandidates(
  sql: Sql,
  meetingTenantIds: string[],
): Promise<MeetingCandidateRow[]> {
  // Each id is its own bound param, not a single array param — the same driver-
  // agnostic `in (...)` shape the reflection job uses (no array-type binding).
  const placeholders = meetingTenantIds.map((_, i) => `$${i + 1}`).join(', ')
  return runQuery<MeetingCandidateRow>(
    sql,
    `select id, tenant_id, meeting_id, "text", confidence, promotion_reason, evidence_refs
     from "action_items"
     where record_origin = 'generated' and review_status = 'promoted'
       and tenant_id in (${placeholders})
     order by created_at asc`,
    meetingTenantIds,
  )
}

/** The subset of these record ids already turned into a proposal for this tenant. */
async function readLedger(
  sql: Sql,
  tenantId: string,
  recordIds: string[],
): Promise<Set<string>> {
  if (recordIds.length === 0) return new Set()
  const placeholders = recordIds.map((_, i) => `$${i + 2}`).join(', ')
  const rows = await runQuery<{ meeting_record_id: string }>(
    sql,
    `select meeting_record_id from "meeting_promotions"
     where tenant_id = $1 and meeting_record_id in (${placeholders})`,
    [tenantId, ...recordIds],
  )
  return new Set(rows.map((row) => row.meeting_record_id))
}

/**
 * Claim this meeting record for the given proposal. Returns false when a concurrent
 * run already claimed it — the ledger's unique index, not the caller, decides.
 *
 * The ledger row cannot be reserved BEFORE the proposal exists (`proposal_id` is
 * `NOT NULL` with an immediate FK), and Neon's HTTP driver has no interactive
 * transaction to roll the proposal back (`provenance/record-write.ts:16`). So the
 * winner is settled after the fact: `returning id` is empty exactly when the insert
 * conflicted, the same "0 rows returned = lost the race" idiom the accept path uses
 * (`proposals/apply.ts:509`). The caller supersedes its surplus proposal.
 */
async function recordPromotion(
  sql: Sql,
  tenantId: string,
  meetingRecordId: string,
  proposalId: string,
): Promise<boolean> {
  const rows = await runQuery<{ id: string }>(
    sql,
    `insert into "meeting_promotions" ("tenant_id", "meeting_record_id", "proposal_id")
     values ($1, $2, $3) on conflict ("tenant_id", "meeting_record_id") do nothing
     returning id`,
    [tenantId, meetingRecordId, proposalId],
  )
  return rows.length > 0
}

/**
 * Latch a surplus proposal out of the pending inbox. `where status = 'pending'`
 * keeps this a no-op if a human somehow decided the proposal first — a decided
 * proposal is never rewritten.
 *
 * Not atomic with the ledger insert: a crash in between still strands a pending
 * duplicate, which is the residue tracked by the concurrency issue. It is strictly
 * better than leaving every loser in the inbox.
 */
async function supersedeProposal(sql: Sql, proposalId: string): Promise<void> {
  await runQuery(
    sql,
    `update "proposals" set status = 'superseded', updated_at = now()
     where id = $1 and status = 'pending'`,
    [proposalId],
  )
}
