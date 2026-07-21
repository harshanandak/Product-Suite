import { randomUUID } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createMemory, supersedeMemory } from '../../src/domain/memories'
import { createWorkItem } from '../../src/domain/work-items'
import { applyProposal } from '../../src/proposals/apply'
import { createProposal, getProposalScoped } from '../../src/proposals/repository'
import type { ActorContext } from '../../src/provenance/record-write'

import { hasNeonCreds, query, withDbBranch } from './harness'

/**
 * Lane A atomic-accept tests (2–9) of the atomic-accept wave — the real-DB half of the
 * "accepted always means applied" guarantee. Each runs the SAME `applyProposal` the
 * production route runs, against an ephemeral Neon branch over the real neon-http driver,
 * so it catches what the mocked unit suite cannot: real UUID casts (the 22P02 regression),
 * the real `applied_from_proposal_id` / `memories_source_proposal_uniq` idempotency
 * indexes, real FK scoping, and true concurrency.
 *
 * Gated on NEON_API_KEY/NEON_PROJECT_ID (see harness) so the default `vitest run` stays
 * green; the dedicated `db-contract` CI job supplies the secrets and runs it for real.
 * The suite-level timeout covers the ~15-20s Neon branch provisioning per test.
 */
const DB_CONTRACT_TIMEOUT_MS = 180_000

/** The accept context every test uses — the seed approver acting in the seed tenant. */
function acceptCtx(tenantId: string, userId: string) {
  return { tenantIds: [tenantId], approverUserId: userId }
}

describe.skipIf(!hasNeonCreds())(
  'db-contract: atomic accept path (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    it('2: a malformed team_id at accept → invalid, proposal stays pending, no row (22P02 regression)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        // A slug bound to a `uuid` column is the exact class that used to escape as a raw
        // 500 (leaving the proposal applied-without-a-row). Accept-time validation must
        // turn it into a clean, recoverable `invalid` with NOTHING written.
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Bad team id', team_id: 'open' },
        })

        const result = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(result.status).toBe('invalid')
        if (result.status !== 'invalid') throw new Error('unreachable')
        expect(result.retryable).toBe(true)

        // Stays reviewable, and NO work item was created.
        const pending = await getProposalScoped(sql, proposal.id, [seed.tenantId])
        expect(pending?.status).toBe('pending')
        const rows = await query(sql, `select id from work_items where tenant_id = $1`, [seed.tenantId])
        expect(rows).toHaveLength(0)
      })
    })

    it('3: a successful accept stamps applied_from_proposal_id + applied_write and flips the proposal', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Stamped create', team_id: seed.teamId },
        })

        const result = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(result.status).toBe('applied')
        if (result.status !== 'applied') throw new Error('unreachable')

        // The idempotency key is stamped on the row.
        const wi = await query<{ applied_from_proposal_id: string | null }>(
          sql,
          `select applied_from_proposal_id from work_items where id = $1`,
          [result.item_id],
        )
        expect(wi[0]?.applied_from_proposal_id).toBe(proposal.id)

        // The proposal is flipped with the write snapshot + decider recorded.
        const prop = await query<{ status: string; applied_write: unknown; decided_by: string | null }>(
          sql,
          `select status, applied_write, decided_by from proposals where id = $1`,
          [proposal.id],
        )
        expect(prop[0]?.status).toBe('applied')
        expect(prop[0]?.applied_write).not.toBeNull()
        expect(prop[0]?.decided_by).toBe(seed.userId)
      })
    })

    it('4: a forced write failure (FK violation) → not applied, no partial row', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        // A well-formed but NON-EXISTENT status_id: it passes accept-time UUID validation,
        // then the domain write fails (unknown status / FK). The write ran while the
        // proposal was still pending, so the transaction rolls back and nothing is stranded.
        const ghostStatus = randomUUID()
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'FK failure', team_id: seed.teamId, status_id: ghostStatus },
        })

        const result = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(result.status).toBe('invalid')

        // NOT applied, and no partial row — the "applied-without-a-row" ghost is unreachable.
        const pending = await getProposalScoped(sql, proposal.id, [seed.tenantId])
        expect(pending?.status).toBe('pending')
        const rows = await query(sql, `select id from work_items where tenant_id = $1`, [seed.tenantId])
        expect(rows).toHaveLength(0)
      })
    })

    it('5: re-accepting an applied proposal is a no-op (not_pending), never a duplicate row', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Accept once', team_id: seed.teamId },
        })

        const first = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(first.status).toBe('applied')
        if (first.status !== 'applied') throw new Error('unreachable')

        // A second Accept click on the same (now applied) proposal — the flip guard makes it
        // a harmless no-op, and the unique index means it can never spawn a second row.
        const second = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(second.status).toBe('not_pending')

        const rows = await query<{ id: string }>(
          sql,
          `select id from work_items where applied_from_proposal_id = $1`,
          [proposal.id],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.id).toBe(first.item_id)
      })
    })

    it('6: crash after write, before flip → re-accept converges on the SAME row and flips (single row)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Crashed create', team_id: seed.teamId },
        })

        // Crash-sim: the domain write succeeded (row exists, keyed to THIS proposal) but the
        // process died before the flip — the proposal is still `pending`. This is the exact
        // state the reorder makes recoverable.
        const actor: ActorContext = {
          actorType: 'agent',
          actorId: seed.runId,
          onBehalfOf: seed.userId,
          runId: seed.runId,
        }
        const pre = await createWorkItem(
          sql,
          { tenantId: seed.tenantId, actor, appliedFromProposalId: proposal.id },
          { title: 'Crashed create', team_id: seed.teamId },
        )

        // Re-accept: the create dedups to the existing row (unique index), then the flip runs.
        const result = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(result.status).toBe('applied')
        if (result.status !== 'applied') throw new Error('unreachable')
        expect(result.item_id).toBe(pre.id)

        const rows = await query<{ id: string }>(
          sql,
          `select id from work_items where applied_from_proposal_id = $1`,
          [proposal.id],
        )
        expect(rows).toHaveLength(1)
        const decided = await getProposalScoped(sql, proposal.id, [seed.tenantId])
        expect(decided?.status).toBe('applied')
      })
    })

    it('7: a snapshotted team survives a 2nd team added before re-drive → uses persisted id (6055d30e)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        // A create that omits team_id. The first accept resolves the sole team AND snapshots
        // the resolved id into edited_payload, so the decision records the exact team used.
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Snapshot team' },
        })

        const first = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(first.status).toBe('applied')
        if (first.status !== 'applied') throw new Error('unreachable')
        const firstItemId = first.item_id

        // The snapshot landed: edited_payload now pins the resolved team id.
        const snap = await query<{ edited_payload: { team_id?: string } | null }>(
          sql,
          `select edited_payload from proposals where id = $1`,
          [proposal.id],
        )
        expect(snap[0]?.edited_payload?.team_id).toBe(seed.teamId)

        // Add a SECOND team — a FRESH resolution would now be ambiguous (team_required_multiple).
        // Re-drive the SAME proposal (reset to pending): it must read the snapshotted team_id,
        // converge on the same row via the idempotency key, and never raise the ambiguity error.
        await query(sql, `insert into teams (id, tenant_id, name) values ($1, $2, $3)`, [
          randomUUID(),
          seed.tenantId,
          'Second Team',
        ])
        await query(
          sql,
          `update proposals set status = 'pending', decided_by = null, decided_at = null where id = $1`,
          [proposal.id],
        )

        const redrive = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(redrive.status).toBe('applied')
        if (redrive.status !== 'applied') throw new Error('unreachable')
        expect(redrive.item_id).toBe(firstItemId)

        const rows = await query<{ team_id: string }>(
          sql,
          `select team_id from work_items where applied_from_proposal_id = $1`,
          [proposal.id],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.team_id).toBe(seed.teamId)
      })
    })

    it('8: concurrent double-accept → exactly ONE row (the mandatory exactly-once proof)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'work_item',
          operation: 'create',
          payload: { title: 'Double accept race', team_id: seed.teamId },
        })

        // Fire two accepts at once. Both run the idempotent create; the unique index lets
        // exactly one row exist, and the `where status='pending'` flip lets exactly one win.
        const [a, b] = await Promise.all([
          applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id),
          applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id),
        ])

        // THE proof: never two rows, regardless of who won the flip.
        const rows = await query<{ id: string }>(
          sql,
          `select id from work_items where applied_from_proposal_id = $1`,
          [proposal.id],
        )
        expect(rows).toHaveLength(1)

        // One accept applied; the loser is a harmless not_pending — neither is a hard error.
        const statuses = [a.status, b.status]
        expect(statuses.filter((s) => s === 'applied')).toHaveLength(1)
        expect(statuses.every((s) => s === 'applied' || s === 'not_pending')).toBe(true)

        const decided = await getProposalScoped(sql, proposal.id, [seed.tenantId])
        expect(decided?.status).toBe('applied')
      })
    })

    it('9: a memory superseded out from under the proposal → stale, stays reviewable (no clobber)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        // A memory the proposal wants to supersede — but a human edits it first.
        const mem = await createMemory(
          sql,
          { tenantId: seed.tenantId, actor: seed.runId },
          { kind: 'fact', title: 'Original fact' },
        )
        // The human's supersede makes the original id no longer the active version.
        await supersedeMemory(
          sql,
          { tenantIds: [seed.tenantId], actor: seed.runId },
          mem.id,
          { title: 'Human-edited fact', changeReason: 'human edited first' },
        )

        // The agent's proposal targets the now-STALE original id.
        const proposal = await createProposal(sql, {
          tenant_id: seed.tenantId,
          run_id: seed.runId,
          target_type: 'memory',
          operation: 'supersede',
          target_id: mem.id,
          payload: { title: 'Agent edit', change_reason: 'from proposal' },
        })

        const result = await applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id)
        expect(result.status).toBe('stale')
        if (result.status !== 'stale') throw new Error('unreachable')
        expect(result.item_id).toBe(mem.id)

        // Never clobbered — the proposal stays pending for the human to reconcile.
        const pending = await getProposalScoped(sql, proposal.id, [seed.tenantId])
        expect(pending?.status).toBe('pending')
      })
    })

    it('flip-loser (create): a reject that wins the race COMPENSATES the orphaned row (996b674c)', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const actor: ActorContext = {
          actorType: 'agent',
          actorId: seed.runId,
          onBehalfOf: seed.userId,
          runId: seed.runId,
        }

        // Drive the flip-loser window: the accept's write commits, a human reject lands
        // out-of-band, then the accept's guarded flip matches 0 rows. The mitigation must
        // re-read the decision and DELETE the row it created (the human's reject wins).
        // The race resolves per run; loop until we observe the in-window compensation and
        // assert the safety invariant on every outcome.
        let compensated = false
        for (let i = 0; i < 8 && !compensated; i++) {
          const proposal = await createProposal(sql, {
            tenant_id: seed.tenantId,
            run_id: seed.runId,
            target_type: 'work_item',
            operation: 'create',
            payload: { title: `Race create ${i}`, team_id: seed.teamId },
          })
          // The write already committed (idempotency key present) while the proposal is
          // still pending — so a row is GUARANTEED to exist before the race. A rows==0 after
          // a `rejected` outcome therefore unambiguously means compensation deleted it.
          await createWorkItem(
            sql,
            { tenantId: seed.tenantId, actor, appliedFromProposalId: proposal.id },
            { title: `Race create ${i}`, team_id: seed.teamId },
          )

          const [res] = await Promise.all([
            applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id),
            query(
              sql,
              `update proposals set status = 'rejected', decided_at = now(), updated_at = now()
               where id = $1 and status = 'pending'`,
              [proposal.id],
            ),
          ])

          const after = await getProposalScoped(sql, proposal.id, [seed.tenantId])
          const rows = await query<{ id: string }>(
            sql,
            `select id from work_items where applied_from_proposal_id = $1`,
            [proposal.id],
          )

          if (after?.status === 'rejected' && rows.length === 0) {
            // In-window loser: the row existed, then the reject won and the accept deleted it.
            expect(res.status).toBe('not_pending')
            compensated = true
          } else if (after?.status === 'applied') {
            // The accept won the flip; its row is kept (reject lost its guarded update).
            expect(rows).toHaveLength(1)
          }
          // rejected + rows==1 → the reject beat the accept's LOAD (early-exit, no write to
          // compensate); not the window under test — retry.
        }
        expect(compensated).toBe(true)
      })
    })

    it('flip-loser (non-create): an in-place update that loses to a reject logs LOUDLY, row left', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const actor: ActorContext = {
          actorType: 'agent',
          actorId: seed.runId,
          onBehalfOf: seed.userId,
          runId: seed.runId,
        }
        // An in-place update has no clean undo, so the mitigation does NOT delete — it emits
        // a loud, alertable console.error for manual reconciliation and leaves the row.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
          let logged = false
          for (let i = 0; i < 8 && !logged; i++) {
            const target = await createWorkItem(
              sql,
              { tenantId: seed.tenantId, actor },
              { title: `Update target ${i}`, team_id: seed.teamId },
            )
            const proposal = await createProposal(sql, {
              tenant_id: seed.tenantId,
              run_id: seed.runId,
              target_type: 'work_item',
              operation: 'update',
              target_id: target.id,
              payload: { title: `Renamed ${i}` },
            })

            errorSpy.mockClear()
            const [res] = await Promise.all([
              applyProposal(sql, acceptCtx(seed.tenantId, seed.userId), proposal.id),
              query(
                sql,
                `update proposals set status = 'rejected', decided_at = now(), updated_at = now()
                 where id = $1 and status = 'pending'`,
                [proposal.id],
              ),
            ])

            // The target work item is NEVER deleted — there is no undo for an in-place write.
            const rows = await query<{ id: string }>(sql, `select id from work_items where id = $1`, [target.id])
            expect(rows).toHaveLength(1)

            const after = await getProposalScoped(sql, proposal.id, [seed.tenantId])
            const loudLog = errorSpy.mock.calls
              .map((c) => String(c[0]))
              .some((m) => m.includes(proposal.id) && m.includes('reconciliation'))
            if (after?.status === 'rejected' && loudLog) {
              // In-window loser: the update committed, then the reject won → loud log, no undo.
              expect(res.status).toBe('not_pending')
              logged = true
            } else if (after?.status === 'applied') {
              expect(res.status).toBe('applied')
            }
            // rejected without the log → the reject beat the accept's LOAD (early-exit); retry.
          }
          expect(logged).toBe(true)
        } finally {
          errorSpy.mockRestore()
        }
      })
    })
  },
)
