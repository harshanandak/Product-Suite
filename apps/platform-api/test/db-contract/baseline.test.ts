import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { applyProposal } from '../../src/proposals/apply'
import { createProposal, getProposalScoped } from '../../src/proposals/repository'
import type { WorkItemRow } from '../../src/domain/work-items'

import { hasNeonCreds, query, withDbBranch } from './harness'

/**
 * Lane B baseline tests (1, 10, 11, 12) of the atomic-accept wave. These exercise
 * the REAL accept/create path against an ephemeral Neon branch — the same code the
 * production route runs, over the same neon-http driver — so they catch what the
 * mocked suites cannot (migration drift, real UUID casts, real FK scoping).
 *
 * Skipped without NEON_API_KEY/NEON_PROJECT_ID so the default `vitest run` stays
 * green; the `db-contract` CI job supplies the secrets and runs it for real.
 */
describe.skipIf(!hasNeonCreds())('db-contract: baseline accept path (real Neon branch)', () => {
  it('1: create-with-defaults persists the resolved team + default status ids', async () => {
    await withDbBranch(async ({ sql, seed }) => {
      // A create proposal that omits team_id and status_id — the accept path must
      // resolve the sole team and its default (Backlog) status server-side.
      const proposal = await createProposal(sql, {
        tenant_id: seed.tenantId,
        run_id: seed.runId,
        target_type: 'work_item',
        operation: 'create',
        payload: { title: 'Contract create with defaults' },
        actor_type: 'agent',
      })

      const result = await applyProposal(
        sql,
        { tenantIds: [seed.tenantId], approverUserId: seed.userId },
        proposal.id,
      )

      expect(result.applied).toBe(true)
      if (!result.applied) throw new Error('unreachable')
      const item = result.result as WorkItemRow
      expect(item.team_id).toBe(seed.teamId)
      expect(item.status_id).toBe(seed.defaultStatusId)

      // Persisted for real, with the idempotency key stamped, and the proposal flipped.
      const rows = await query<{ team_id: string; status_id: string; applied_from_proposal_id: string | null }>(
        sql,
        `select team_id, status_id, applied_from_proposal_id from work_items where id = $1`,
        [item.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.team_id).toBe(seed.teamId)
      expect(rows[0]?.status_id).toBe(seed.defaultStatusId)
      expect(rows[0]?.applied_from_proposal_id).toBe(proposal.id)

      const decided = await getProposalScoped(sql, proposal.id, [seed.tenantId])
      expect(decided?.status).toBe('applied')
    })
  })

  it('10: the full migration chain applies cleanly on a fresh branch (no schema drift)', async () => {
    await withDbBranch(async ({ sql }) => {
      // Every workboard table the accept path touches (or that a rollup reads) exists.
      const tables = await query<{ table_name: string }>(
        sql,
        `select table_name from information_schema.tables where table_schema = 'public'`,
      )
      const present = new Set(tables.map((t) => t.table_name))
      for (const t of [
        'tenants',
        'users',
        'teams',
        'statuses',
        'work_items',
        'activity_events',
        'agent_runs',
        'proposals',
        'memories',
        'projects',
      ]) {
        expect(present.has(t), `expected table "${t}" to exist after migrations`).toBe(true)
      }

      // The idempotency backbone the atomic-accept fix relies on.
      const idx = await query(
        sql,
        `select 1 from pg_indexes where indexname = 'work_items_applied_from_proposal_uniq'`,
      )
      expect(idx).toHaveLength(1)

      // The proposal lifecycle enum carries the terminal states the accept path sets.
      const labels = await query<{ enumlabel: string }>(
        sql,
        `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'proposal_status'`,
      )
      const states = new Set(labels.map((l) => l.enumlabel))
      for (const s of ['pending', 'applied', 'failed']) {
        expect(states.has(s), `expected proposal_status to include "${s}"`).toBe(true)
      }
    })
  })

  it('11: accepting a proposal from another tenant → not_found (route maps to 404)', async () => {
    await withDbBranch(async ({ sql, seed }) => {
      // A second tenant with its own run + proposal, invisible to the seed tenant.
      const otherTenant = randomUUID()
      const otherRun = randomUUID()
      await query(sql, `insert into tenants (id, name) values ($1, $2)`, [otherTenant, 'Other Org'])
      await query(
        sql,
        `insert into agent_runs (id, tenant_id, triggered_by, kind, status) values ($1, $2, $3, 'agent_run', 'running')`,
        [otherRun, otherTenant, seed.userId],
      )
      const proposal = await createProposal(sql, {
        tenant_id: otherTenant,
        run_id: otherRun,
        target_type: 'work_item',
        operation: 'create',
        payload: { title: 'Foreign proposal' },
      })

      // Accept as the SEED tenant's approver — scoping must hide it entirely.
      const result = await applyProposal(
        sql,
        { tenantIds: [seed.tenantId], approverUserId: seed.userId },
        proposal.id,
      )
      expect(result.applied).toBe(false)
      if (result.applied) throw new Error('unreachable')
      expect(result.reason).toBe('not_found')

      // Untouched — still pending in its own tenant, no cross-tenant write.
      const untouched = await getProposalScoped(sql, proposal.id, [otherTenant])
      expect(untouched?.status).toBe('pending')
    })
  })

  it('12: a non-create proposal with no target_id terminally fails (invalid)', async () => {
    await withDbBranch(async ({ sql, seed }) => {
      // An update names no target — a permanent structural failure, not a retryable one.
      const proposal = await createProposal(sql, {
        tenant_id: seed.tenantId,
        run_id: seed.runId,
        target_type: 'work_item',
        operation: 'update',
        target_id: null,
        payload: { title: 'Update to nowhere' },
      })

      const result = await applyProposal(
        sql,
        { tenantIds: [seed.tenantId], approverUserId: seed.userId },
        proposal.id,
      )
      expect(result.applied).toBe(false)
      if (result.applied) throw new Error('unreachable')
      expect(result.reason).toBe('invalid')

      // The proposal is terminally `failed` with a legible reason — never left pending.
      const failed = await getProposalScoped(sql, proposal.id, [seed.tenantId])
      expect(failed?.status).toBe('failed')
      expect(failed?.rejection_reason).toContain('no target_id')
    })
  })
})
