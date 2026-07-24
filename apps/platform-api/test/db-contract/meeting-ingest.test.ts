import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { runMeetingIngest } from '../../src/meeting/ingest'
import { parseMeetingTenantMap } from '../../src/meeting/tenant-map'
import { applyProposal } from '../../src/proposals/apply'
import type { Sql } from '@product-suite/db'

import { hasNeonCreds, query, withDbBranch } from './harness'

/**
 * The real-DB half of Task B.2. The mock unit suite (`src/meeting/ingest.test.ts`)
 * pins the shape of the SQL the ingest emits; only this tier can prove the SQL
 * actually *behaves* — that the `record_origin`/`review_status` predicates filter,
 * that the `meeting_promotions` unique index really makes a re-run a no-op, and
 * that an accepted meeting proposal lands `work_items.source = 'meeting'` in a
 * live column rather than merely reaching the domain command.
 *
 * It is also the only place migration `0016_meeting_schema.sql` is EXECUTED: the
 * harness walks the whole journal against a fresh branch, so a `meeting` schema
 * that does not apply on Postgres fails here.
 *
 * Gated on NEON_API_KEY/NEON_PROJECT_ID (see harness) so the default `vitest run`
 * stays green; the dedicated `db-contract` CI job supplies the secrets.
 */
const DB_CONTRACT_TIMEOUT_MS = 180_000

const MEETING_TENANT = 'tenant_meeting_pilot'
const OTHER_MEETING_TENANT = 'tenant_meeting_other'

/** Create the meeting-side tenant + meeting a candidate can hang off. */
async function seedMeetingContext(sql: Sql, meetingTenantId: string): Promise<string> {
  const meetingId = `mtg_${randomUUID()}`
  await query(
    sql,
    `insert into meeting.tenants (id, slug, name) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [meetingTenantId, `${meetingTenantId}-slug`, 'Meeting Pilot Org'],
  )
  await query(
    sql,
    `insert into meeting.meetings (id, tenant_id, title, status, engine, created_at, updated_at)
     values ($1, $2, 'Weekly sync', 'completed', 'test', now(), now())`,
    [meetingId, meetingTenantId],
  )
  return meetingId
}

/** Insert one action item; defaults reproduce a promoted, agent-generated candidate. */
async function seedCandidate(
  sql: Sql,
  opts: {
    meetingTenantId: string
    meetingId: string
    id?: string
    text?: string
    recordOrigin?: string
    reviewStatus?: string
    confidence?: number
    promotionReason?: string
  },
): Promise<string> {
  const id = opts.id ?? `ai_${randomUUID()}`
  await query(
    sql,
    `insert into meeting.action_items
       (id, tenant_id, meeting_id, text, record_origin, review_status, confidence,
        promotion_reason, evidence_refs)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      id,
      opts.meetingTenantId,
      opts.meetingId,
      opts.text ?? 'Send the revised quote to Acme by Friday',
      opts.recordOrigin ?? 'generated',
      opts.reviewStatus ?? 'promoted',
      opts.confidence ?? 0.82,
      opts.promotionReason ?? 'Explicit commitment with a named owner and a date',
      JSON.stringify([{ segment_id: 'seg_12' }]),
    ],
  )
  return id
}

describe.skipIf(!hasNeonCreds())(
  'db-contract: meeting ingest (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    it('reads ONLY generated + promoted rows, and only for the mapped tenant', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const tenantMap = parseMeetingTenantMap(JSON.stringify({ [MEETING_TENANT]: seed.tenantId }))
        const meetingId = await seedMeetingContext(sql, MEETING_TENANT)
        const otherMeetingId = await seedMeetingContext(sql, OTHER_MEETING_TENANT)

        const wanted = await seedCandidate(sql, {
          meetingTenantId: MEETING_TENANT,
          meetingId,
          text: 'The one that should be proposed',
        })
        // Each excluded row differs from `wanted` in EXACTLY one respect, so a
        // dropped clause shows up as a specific extra proposal, not a vague count.
        await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId, reviewStatus: 'draft' })
        await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId, recordOrigin: 'human' })
        await seedCandidate(sql, { meetingTenantId: OTHER_MEETING_TENANT, meetingId: otherMeetingId })

        const result = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })

        expect(result.proposalsCreated).toBe(1)
        const proposals = await query<{ context_ref: string; payload: { title: string } }>(
          sql,
          `select context_ref, payload from proposals where tenant_id = $1`,
          [seed.tenantId],
        )
        expect(proposals).toHaveLength(1)
        expect(proposals[0]!.context_ref).toBe(wanted)
        expect(proposals[0]!.payload.title).toBe('The one that should be proposed')
        // The other meeting tenant's promoted row is visible to the job but refused,
        // and the refusal is REPORTED rather than swallowed.
        expect(result.skippedUnmappedTenant).toBe(1)
      })
    })

    it('mints exactly one run and stamps each proposal with reviewable provenance', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const tenantMap = parseMeetingTenantMap(JSON.stringify({ [MEETING_TENANT]: seed.tenantId }))
        const meetingId = await seedMeetingContext(sql, MEETING_TENANT)
        await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId, text: 'First' })
        await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId, text: 'Second' })

        const result = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })
        expect(result.proposalsCreated).toBe(2)

        const runs = await query<{ id: string; kind: string; status: string }>(
          sql,
          `select id, kind, status from agent_runs
           where tenant_id = $1 and triggered_by = 'meeting-ingest'`,
          [seed.tenantId],
        )
        expect(runs).toHaveLength(1) // one per CALL, not per candidate
        expect(runs[0]!.kind).toBe('agent_run')
        expect(runs[0]!.status).toBe('completed')

        const proposals = await query<{
          run_id: string
          target_type: string
          operation: string
          status: string
          actor_type: string
          actor_id: string
          prompt_version: string
          confidence: string | number
          rationale: string
          payload: Record<string, unknown>
        }>(
          sql,
          `select run_id, target_type, operation, status, actor_type, actor_id,
                  prompt_version, confidence, rationale, payload
           from proposals where tenant_id = $1 order by created_at asc`,
          [seed.tenantId],
        )
        expect(proposals).toHaveLength(2)
        for (const proposal of proposals) {
          expect(proposal.run_id).toBe(result.runId)
          expect(proposal.target_type).toBe('work_item')
          expect(proposal.operation).toBe('create')
          expect(proposal.status).toBe('pending') // the column default, never set by us
          expect(proposal.actor_type).toBe('agent')
          expect(proposal.actor_id).toBe(result.runId)
          expect(proposal.prompt_version).toBe('meeting-ingest-v1')
          expect(Number(proposal.confidence)).toBeCloseTo(0.82, 2)
          expect(proposal.rationale).toContain('Explicit commitment')
          // ABSENT, not null — apply.ts resolves the sole team only on a missing key.
          expect('team_id' in proposal.payload).toBe(false)
          expect(proposal.payload.source).toBe('meeting')
        }
        expect(proposals.map((p) => p.payload.title)).toEqual(['First', 'Second'])
      })
    })

    it('accepting a meeting proposal persists work_items.source = meeting', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const tenantMap = parseMeetingTenantMap(JSON.stringify({ [MEETING_TENANT]: seed.tenantId }))
        const meetingId = await seedMeetingContext(sql, MEETING_TENANT)
        const recordId = await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId })

        const result = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })
        const proposalId = result.proposalIds[0]!

        const accepted = await applyProposal(
          sql,
          { tenantIds: [seed.tenantId], approverUserId: seed.userId },
          proposalId,
        )
        expect(accepted.status).toBe('applied')

        const items = await query<{
          source: string
          title: string
          applied_from_proposal_id: string
          team_id: string
        }>(
          sql,
          `select source, title, applied_from_proposal_id, team_id from work_items where tenant_id = $1`,
          [seed.tenantId],
        )
        expect(items).toHaveLength(1)
        // The whole point of payload.source: the board says where the item came from.
        expect(items[0]!.source).toBe('meeting')
        expect(items[0]!.title).toBe('Send the revised quote to Acme by Friday')
        expect(items[0]!.applied_from_proposal_id).toBe(proposalId)
        // team_id was absent from the payload, so accept-time resolution picked the
        // tenant's sole team rather than the ingest guessing one.
        expect(items[0]!.team_id).toBe(seed.teamId)
        // The proposal still points back at the meeting record it came from.
        const proposals = await query<{ context_ref: string }>(
          sql,
          `select context_ref from proposals where id = $1`,
          [proposalId],
        )
        expect(proposals[0]!.context_ref).toBe(recordId)
      })
    })

    it('proposes each candidate exactly once — including across rematerialization', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const tenantMap = parseMeetingTenantMap(JSON.stringify({ [MEETING_TENANT]: seed.tenantId }))
        const meetingId = await seedMeetingContext(sql, MEETING_TENANT)
        const recordId = await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId })

        const first = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })
        expect(first.proposalsCreated).toBe(1)

        const ledger = await query<{ meeting_record_id: string; proposal_id: string }>(
          sql,
          `select meeting_record_id, proposal_id from meeting_promotions where tenant_id = $1`,
          [seed.tenantId],
        )
        expect(ledger).toHaveLength(1)
        expect(ledger[0]!.meeting_record_id).toBe(recordId)
        expect(ledger[0]!.proposal_id).toBe(first.proposalIds[0])

        // A plain re-run is a no-op.
        const second = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })
        expect(second.proposalsCreated).toBe(0)
        expect(second.skippedDuplicate).toBe(1)

        // meeting-api reprocesses by DELETE + re-INSERT (server.py). The row is new;
        // its content-derived id is not — which is exactly why the ledger keys on the
        // id and not on anything row-shaped.
        await query(sql, `delete from meeting.action_items where id = $1`, [recordId])
        await seedCandidate(sql, { meetingTenantId: MEETING_TENANT, meetingId, id: recordId })

        const third = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })
        expect(third.proposalsCreated).toBe(0)
        expect(third.skippedDuplicate).toBe(1)

        const proposals = await query(sql, `select id from proposals where tenant_id = $1`, [
          seed.tenantId,
        ])
        expect(proposals).toHaveLength(1) // one commitment, one proposal, ever
      })
    })

    it('a run with no candidates still mints the run and proposes nothing', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const tenantMap = parseMeetingTenantMap(JSON.stringify({ [MEETING_TENANT]: seed.tenantId }))
        await seedMeetingContext(sql, MEETING_TENANT)

        const result = await runMeetingIngest(sql, { tenantId: seed.tenantId, tenantMap })

        expect(result.proposalsCreated).toBe(0)
        expect(result.skippedDuplicate).toBe(0)
        expect(result.skippedUnmappedTenant).toBe(0)
        expect(result.proposalIds).toEqual([])

        const runs = await query(
          sql,
          `select id from agent_runs where tenant_id = $1 and triggered_by = 'meeting-ingest'`,
          [seed.tenantId],
        )
        expect(runs).toHaveLength(1)
        const proposals = await query(sql, `select id from proposals where tenant_id = $1`, [
          seed.tenantId,
        ])
        expect(proposals).toHaveLength(0)
      })
    })
  },
)
