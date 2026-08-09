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
 * Gated on NEON_API_KEY/NEON_PROJECT_ID (see harness) so the default `vitest run`
 * stays green; the dedicated `db-contract` CI job supplies the secrets.
 */
const DB_CONTRACT_TIMEOUT_MS = 180_000

/**
 * `meetings` and `action_items` live in the platform `public` schema but are
 * ALEMBIC-owned, so the Drizzle journal the harness replays does not create them —
 * exactly like `tenants` and `users`, for which the harness already installs
 * minimal stand-ins. These two are this suite's equivalent.
 *
 * The `action_items` column list, types, nullability and defaults below were read
 * from `information_schema` against the LIVE Neon database, not from the Alembic
 * history — so a drift between them shows up as a failing seed here rather than as
 * a surprise in production.
 */
async function createAlembicOwnedTables(sql: Sql): Promise<void> {
  await query(
    sql,
    `create table if not exists meetings (
       id text primary key,
       tenant_id text references tenants(id) on delete cascade,
       owner_user_id text references users(id) on delete cascade,
       title text not null,
       status text not null,
       engine text not null,
       visibility text not null default 'private',
       project_name text,
       tags text[] not null default '{}',
       participant_labels text[] not null default '{}',
       started_at timestamptz,
       ended_at timestamptz,
       primary_language text not null default 'unknown',
       buddy_mode text not null default 'addressable',
       duration_seconds integer not null default 0,
       segment_count integer not null default 0,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`,
  )
  await query(
    sql,
    `create table if not exists action_items (
       id text primary key,
       tenant_id text not null references tenants(id) on delete cascade,
       meeting_id text not null references meetings(id) on delete cascade,
       chapter_summary_id text,
       "text" text not null,
       status text not null default 'open',
       owner_user_id text references users(id) on delete set null,
       due_at timestamptz,
       evidence_refs jsonb not null default '[]'::jsonb,
       record_origin text not null default 'generated',
       review_status text not null default 'draft',
       confidence double precision not null default 0,
       promotion_reason text,
       source_window_start double precision,
       source_window_end double precision,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     )`,
  )
}

/**
 * A second tenant, so "another tenant's promoted row is refused" is a real
 * cross-tenant case rather than a made-up id that no FK would accept.
 */
async function seedExtraTenant(sql: Sql): Promise<string> {
  // A Clerk-style org id, matching what live `public.tenants` actually holds
  // alongside uuids — a uuid-only fixture would not exercise the real key space.
  const tenantId = `org_${randomUUID().replaceAll('-', '')}`
  await query(sql, `insert into tenants (id, slug, name) values ($1, $2, $3)`, [
    tenantId,
    `contract-${tenantId}`,
    'Other Org',
  ])
  return tenantId
}

/** Create a meeting a candidate can hang off, for the given tenant. */
async function seedMeeting(sql: Sql, tenantId: string): Promise<string> {
  const meetingId = `mtg_${randomUUID()}`
  await query(
    sql,
    `insert into meetings (id, tenant_id, title, status, engine) values ($1, $2, $3, $4, $5)`,
    [meetingId, tenantId, 'Weekly sync', 'completed', 'test'],
  )
  return meetingId
}

/** Insert one action item; defaults reproduce a promoted, agent-generated candidate. */
async function seedCandidate(
  sql: Sql,
  opts: {
    tenantId: string
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
    `insert into action_items
       (id, tenant_id, meeting_id, "text", record_origin, review_status, confidence,
        promotion_reason, evidence_refs)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      id,
      opts.tenantId,
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

/**
 * The allowlist for a test: the seed tenant mapped to itself. Meeting rows and the
 * board share `public.tenants`, so the configured map is identity — an allowlist of
 * which tenants ingest, not a translation table.
 */
function identityMap(tenantId: string) {
  return parseMeetingTenantMap(JSON.stringify({ [tenantId]: tenantId }))
}

describe.skipIf(!hasNeonCreds())(
  'db-contract: meeting ingest (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    it('reads ONLY generated + promoted rows, and only for the mapped tenant', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        await createAlembicOwnedTables(sql)
        const tenantMap = identityMap(seed.tenantId)
        const meetingId = await seedMeeting(sql, seed.tenantId)
        const otherTenantId = await seedExtraTenant(sql)
        const otherMeetingId = await seedMeeting(sql, otherTenantId)

        const wanted = await seedCandidate(sql, {
          tenantId: seed.tenantId,
          meetingId,
          text: 'The one that should be proposed',
        })
        // Each excluded row differs from `wanted` in EXACTLY one respect, so a
        // dropped clause shows up as a specific extra proposal, not a vague count.
        await seedCandidate(sql, { tenantId: seed.tenantId, meetingId, reviewStatus: 'draft' })
        await seedCandidate(sql, { tenantId: seed.tenantId, meetingId, recordOrigin: 'human' })
        await seedCandidate(sql, { tenantId: otherTenantId, meetingId: otherMeetingId })

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

        // The other tenant's promoted row is never READ, so it is never proposed for
        // anyone — the strongest form of the guarantee. And the caller learns nothing
        // about it: `skippedUnmappedTenant` counts only rows this caller's own scope
        // returned, so an out-of-scope row leaves it at 0 rather than disclosing that
        // somebody else has promoted work.
        expect(result.skippedUnmappedTenant).toBe(0)
        expect(result.tenantAllowlisted).toBe(true)
        const foreignProposals = await query(
          sql,
          `select id from proposals where tenant_id = $1`,
          [otherTenantId],
        )
        expect(foreignProposals).toHaveLength(0)
      })
    })

    it('mints exactly one run and stamps each proposal with reviewable provenance', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        await createAlembicOwnedTables(sql)
        const tenantMap = identityMap(seed.tenantId)
        const meetingId = await seedMeeting(sql, seed.tenantId)
        await seedCandidate(sql, { tenantId: seed.tenantId, meetingId, text: 'First' })
        await seedCandidate(sql, { tenantId: seed.tenantId, meetingId, text: 'Second' })

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
        await createAlembicOwnedTables(sql)
        const tenantMap = identityMap(seed.tenantId)
        const meetingId = await seedMeeting(sql, seed.tenantId)
        const recordId = await seedCandidate(sql, { tenantId: seed.tenantId, meetingId })

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
        await createAlembicOwnedTables(sql)
        const tenantMap = identityMap(seed.tenantId)
        const meetingId = await seedMeeting(sql, seed.tenantId)
        const recordId = await seedCandidate(sql, { tenantId: seed.tenantId, meetingId })

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
        await query(sql, `delete from action_items where id = $1`, [recordId])
        await seedCandidate(sql, { tenantId: seed.tenantId, meetingId, id: recordId })

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
        await createAlembicOwnedTables(sql)
        const tenantMap = identityMap(seed.tenantId)
        await seedMeeting(sql, seed.tenantId)

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
