// Reach the Neon (serverless HTTP) client through the workspace db package, which
// already declares `@neondatabase/serverless` as a dependency. platform-web itself
// does NOT depend on the driver, so we import the package's `createSql` helper by
// relative path rather than adding a new dependency just for this one e2e probe.
import { createSql } from "../../../packages/db/src/index";

/**
 * Persisted-provenance probe for the moat-loop spec.
 *
 * The moat's real claim is durable, not cosmetic: accepting a proposal must leave
 * a permanent `work_items.applied_from_proposal_id` pointer back to the proposal it
 * was applied from — the same linkage the API's idempotent re-drive relies on. The
 * UI banner alone can't prove that, so this reads it straight from Neon.
 *
 * Returns:
 *  - `undefined` when `DATABASE_URL` is unset — the caller SOFT-SKIPS the check so
 *    the spec still runs UI-only (e.g. deployed mode without DB access).
 *  - the created work item's `{ id, title }` when a row is linked to `proposalId`.
 *  - `null` when no work item is linked to `proposalId` (a real provenance failure).
 */
export async function readWorkItemAppliedFrom(
  proposalId: string,
): Promise<{ id: string; title: string } | null | undefined> {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  const sql = createSql(url);
  const rows = (await sql`
    select id, title
    from work_items
    where applied_from_proposal_id = ${proposalId}
    limit 1
  `) as { id: string; title: string }[];

  return rows[0] ?? null;
}

// ───────────────────────── meeting-loop seed / readback / cleanup ──────────────
//
// `meeting-loop.spec.ts` cannot ask a real meeting to happen, so it seeds the ONE
// row the ingest reads — a promoted, generated `public.action_items` row — and then
// drives the real UI from there. The seed is direct SQL rather than an API call on
// purpose: there is no platform endpoint that writes meeting action items (that is
// meeting-api's job), and inventing one to make a test easier would ship a write
// path nothing in production uses.
//
// `public.action_items` is in the SAME database as `work_items`: the meeting tables
// were never moved out of Neon (Task 0.1). Its `meeting_id` and `tenant_id` are real
// FKs (`action_items_meeting_id_fkey` → `meetings.id`,
// `action_items_tenant_id_fkey` → `tenants.id`), read from `information_schema`, so
// the seed has to create a meeting row too and the tenant must already exist.

/** The identifiers one seeded meeting candidate occupies, for readback + cleanup. */
export interface SeededMeetingCandidate {
  /** The seeded `meetings.id`. */
  meetingId: string;
  /** The seeded `action_items.id` — meeting-api's CONTENT-DERIVED id shape. */
  recordId: string;
}

/** Every DB helper here soft-skips the same way `readWorkItemAppliedFrom` does. */
function sqlOrUndefined(): ReturnType<typeof createSql> | undefined {
  const url = process.env.DATABASE_URL;
  return url ? createSql(url) : undefined;
}

/**
 * Seed one promoted meeting action item for `tenantId`, plus the `meetings` row its
 * FK requires.
 *
 * `recordId` is unique per run and content-shaped (`e2e-meeting-loop-<ts>`), not a
 * uuid: `meeting_promotions` keys dedup on that TEXT id precisely because
 * meeting-api rematerializes action items by DELETE + re-INSERT, and the spec's
 * idempotence step depends on the id being the stable thing about the row.
 *
 * Returns `undefined` when `DATABASE_URL` is unset (the caller skips the spec —
 * without a seed there is nothing for the loop to ingest).
 */
export async function seedMeetingCandidate(input: {
  tenantId: string;
  text: string;
}): Promise<SeededMeetingCandidate | undefined> {
  const sql = sqlOrUndefined();
  if (!sql) return undefined;

  const stamp = Date.now();
  const meetingId = `e2e-meeting-${stamp}`;
  const recordId = `e2e-meeting-loop-${stamp}`;

  // `meetings.created_at`/`updated_at` are NOT NULL with NO default, so they are
  // supplied explicitly rather than left to the server clock.
  await sql`
    insert into meetings (id, tenant_id, title, status, engine, created_at, updated_at)
    values (${meetingId}, ${input.tenantId}, ${"E2E meeting loop " + String(stamp)},
            'idle', 'whisper', now(), now())
  `;

  // record_origin/review_status are spelled out even though one matches its column
  // default: these two predicates are the whole reason the ingest reads this row,
  // so the seed must state them rather than inherit them.
  await sql`
    insert into action_items
      (id, tenant_id, meeting_id, "text", evidence_refs, record_origin, review_status,
       confidence, promotion_reason)
    values (${recordId}, ${input.tenantId}, ${meetingId}, ${input.text}, '[]'::jsonb,
            'generated', 'promoted', 0.91,
            'Committed to in the E2E meeting-loop transcript.')
  `;

  return { meetingId, recordId };
}

/**
 * The work item a proposal applied to, with the provenance the meeting loop claims:
 * `source` must be `'meeting'` (Task B.2 test 11 established `createWorkItem`
 * persists `payload.source`) and `applied_from_proposal_id` links it back.
 */
export async function readMeetingWorkItem(
  proposalId: string,
): Promise<{ id: string; title: string; source: string } | null | undefined> {
  const sql = sqlOrUndefined();
  if (!sql) return undefined;

  const rows = (await sql`
    select id, title, source
    from work_items
    where applied_from_proposal_id = ${proposalId}
    limit 1
  `) as { id: string; title: string; source: string }[];

  return rows[0] ?? null;
}

/**
 * How many proposals and ledger rows one seeded record has produced.
 *
 * Both counts together are what proves the ledger END-TO-END: a second ingest that
 * left `proposals` at 1 but wrote a second ledger row (or vice versa) would still be
 * a broken exactly-once, and a single count could not tell.
 */
export async function readMeetingIngestCounts(input: {
  tenantId: string;
  recordId: string;
}): Promise<{ proposals: number; ledgerRows: number } | undefined> {
  const sql = sqlOrUndefined();
  if (!sql) return undefined;

  const proposalRows = (await sql`
    select count(*)::int as n
    from proposals
    where tenant_id = ${input.tenantId} and context_ref = ${input.recordId}
  `) as { n: number }[];
  const ledgerRows = (await sql`
    select count(*)::int as n
    from meeting_promotions
    where tenant_id = ${input.tenantId} and meeting_record_id = ${input.recordId}
  `) as { n: number }[];

  return {
    proposals: Number(proposalRows[0]?.n ?? 0),
    ledgerRows: Number(ledgerRows[0]?.n ?? 0),
  };
}

/**
 * Remove everything one meeting-loop run put in the SHARED database, so re-runs
 * start clean and no test row is left for a human to wonder about.
 *
 * Deletion order follows the FKs: the work item points at the proposal
 * (`applied_from_proposal_id`), the proposal points at the run (`run_id`), and the
 * ledger row points at the proposal (`ON DELETE cascade`, so deleting the proposal
 * takes it). The action item points at the meeting. Every statement is scoped by
 * tenant AND by this run's unique ids — a cleanup helper that could widen into
 * "delete the meeting tables" is not worth having in a shared database.
 */
export async function cleanupMeetingCandidate(input: {
  tenantId: string;
  recordId: string;
  meetingId: string;
}): Promise<void> {
  const sql = sqlOrUndefined();
  if (!sql) return;

  const proposalRows = (await sql`
    select id, run_id
    from proposals
    where tenant_id = ${input.tenantId} and context_ref = ${input.recordId}
  `) as { id: string; run_id: string | null }[];

  for (const proposal of proposalRows) {
    await sql`
      delete from work_items
      where tenant_id = ${input.tenantId} and applied_from_proposal_id = ${proposal.id}
    `;
    // Cascades the `meeting_promotions` row keyed to this proposal.
    await sql`delete from proposals where id = ${proposal.id}`;
    if (proposal.run_id !== null) {
      await sql`delete from agent_runs where id = ${proposal.run_id}`;
    }
  }

  // A ledger row can exist without a surviving proposal only if something deleted
  // the proposal out from under it; sweep by key so cleanup is not order-dependent.
  await sql`
    delete from meeting_promotions
    where tenant_id = ${input.tenantId} and meeting_record_id = ${input.recordId}
  `;
  await sql`
    delete from action_items
    where tenant_id = ${input.tenantId} and id = ${input.recordId}
  `;
  await sql`
    delete from meetings
    where tenant_id = ${input.tenantId} and id = ${input.meetingId}
  `;
  // The ingest mints one run per CALL, so the syncs that proposed nothing left runs
  // behind with no proposal to find them by. They are identified by the reserved
  // `triggered_by` sentinel and this tenant, and only the ones with no surviving
  // proposal are removed.
  await sql`
    delete from agent_runs
    where tenant_id = ${input.tenantId}
      and triggered_by = 'meeting-ingest'
      and not exists (select 1 from proposals p where p.run_id = agent_runs.id)
  `;
}
