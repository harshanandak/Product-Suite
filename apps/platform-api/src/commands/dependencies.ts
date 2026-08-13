import {
  buildCommandPersistenceQueries,
  canonicalCommandRequestHash,
  CommandPersistenceError,
  findCommandReplay,
  type Sql,
} from '@product-suite/db'

import { resolveCapabilityContext } from '../auth/capabilities'
import { createWorkItem, updateWorkItem, type CommandTransactionState } from '../domain/work-items'
import { getProposalScoped } from '../proposals/repository'
import { commandResult, type CommandRegistryDependencies, type RegistryMutation, type RegistryResult } from './registry'

function query(sql: Sql, text: string, params: unknown[]): unknown {
  return (sql as unknown as { query: (queryText: string, queryParams: unknown[]) => unknown }).query(text, params)
}

function requestHash(mutation: RegistryMutation): string {
  return canonicalCommandRequestHash(mutation.replayInput)
}

function persistenceTail(sql: Sql, mutation: RegistryMutation, state: {
  resourceId: string
  resourceVersion: number
  before: Record<string, unknown> | null
  after: Record<string, unknown>
}, prefix: readonly unknown[] = []): readonly unknown[] {
  const response: RegistryResult = commandResult(mutation, { id: state.resourceId, version: state.resourceVersion })
  const ledger = buildCommandPersistenceQueries(sql as never, {
    tenantId: mutation.tenantId,
    actorType: 'human',
    actorId: mutation.actor.id,
    command: mutation.invokedCommand,
    idempotencyKey: mutation.idempotencyKey,
    requestHash: requestHash(mutation),
    requestId: mutation.requestId,
    response,
    resourceVersion: state.resourceVersion,
    ...(mutation.onBehalfOf ? { onBehalfOf: mutation.onBehalfOf.id } : {}),
    capability: 'edit',
    approval: mutation.approval,
    targetType: 'work_item',
    targetId: state.resourceId,
    before: state.before,
    after: state.after,
  })
  return [...prefix, ...ledger]
}

export function commandRegistryDependencies(sql: Sql): CommandRegistryDependencies {
  return {
    async resolveAuthority(claims, tenantId) {
      const result = await resolveCapabilityContext(sql, claims, tenantId)
      if (!result.ok) return null
      return {
        tenantId: result.context.tenantId,
        userId: result.context.userId,
        capabilities: result.context.capabilities,
      }
    },
    async findReplay(mutation) {
      try {
        const replay = await findCommandReplay(sql as never, {
          tenantId: mutation.tenantId,
          actorType: 'human',
          actorId: mutation.actor.id,
          command: mutation.invokedCommand,
          idempotencyKey: mutation.idempotencyKey,
          requestHash: requestHash(mutation),
        })
        return replay
          ? { sameInput: true, result: replay.response as RegistryResult }
          : null
      } catch (cause) {
        if (cause instanceof CommandPersistenceError) {
          return {
            sameInput: false,
            result: commandResult(mutation, { id: '', version: 0 }),
          }
        }
        throw cause
      }
    },
    async loadWorkItem(tenantId, id) {
      const rows = (await sql`
        select * from work_items where id = ${id} and tenant_id = ${tenantId} limit 1
      `) as Array<{ id: string; tenant_id: string; version: number }>
      return rows[0] ?? null
    },
    async createWorkItem(mutation) {
      const input = mutation.input
      const row = await createWorkItem(
        sql,
        {
          tenantId: mutation.tenantId,
          actor: { actorType: 'human', actorId: mutation.actor.id },
          commandTransactionTail: (state) => persistenceTail(sql, mutation, state),
        },
        input,
      )
      return { id: row.id, version: row.version }
    },
    async updateWorkItem(mutation) {
      const workItemId = mutation.input.workItemId
      const patch = mutation.input.patch
      if (typeof workItemId !== 'string' || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('COMMAND_ENVELOPE_INVALID')
      }
      const row = await updateWorkItem(
        sql,
        {
          tenantIds: [mutation.tenantId],
          actor: { actorType: 'human', actorId: mutation.actor.id },
          expectedVersion: mutation.expectedVersion,
          commandTransactionTail: (state) => persistenceTail(sql, mutation, state),
        },
        workItemId,
        patch,
      )
      return { id: row.id, version: row.version }
    },
    async loadProposal(tenantId, id) {
      return getProposalScoped(sql, id, [tenantId])
    },
    async applyProposal(mutation) {
      const proposalId = mutation.input.proposalId
      if (typeof proposalId !== 'string') throw new Error('COMMAND_ENVELOPE_INVALID')
      const proposal = await getProposalScoped(sql, proposalId, [mutation.tenantId])
      if (!proposal || !['accepted', 'accepted_with_edits'].includes(proposal.status)) {
        throw new Error('COMMAND_APPROVAL_REQUIRED')
      }
      if (!mutation.onBehalfOf || !proposal.run_id) throw new Error('COMMAND_APPROVAL_REQUIRED')
      const agentId = mutation.onBehalfOf.id
      const runId = proposal.run_id
      const flip = (state: { resourceId: string; resourceVersion: number; after: Record<string, unknown> }) => query(
        sql,
        `with flipped as (
           update proposals set status = 'applied', decided_at = coalesce(decided_at, now()),
             applied_write = $1::jsonb, updated_at = now()
           where id = $2 and tenant_id = $3 and status in ('accepted', 'accepted_with_edits')
           returning id
         )
         select case when exists (select 1 from flipped) then 1
           else cast('COMMAND_VERSION_CONFLICT' as integer) end as proposal_applied`,
        [JSON.stringify(state.after), proposalId, mutation.tenantId],
      )
      const tail = (state: CommandTransactionState) =>
        persistenceTail(sql, mutation, state, [flip(state)])
      if (mutation.command === 'work-item.create') {
        const row = await createWorkItem(
          sql,
          {
            tenantId: mutation.tenantId,
            actor: {
              actorType: 'agent',
              actorId: agentId,
              onBehalfOf: mutation.actor.id,
              runId,
            },
            appliedFromProposalId: proposalId,
            commandTransactionTail: tail,
          },
          mutation.input,
        )
        return { id: row.id, version: row.version }
      }
      const id = mutation.input.workItemId
      const patch = mutation.input.patch
      if (typeof id !== 'string' || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('COMMAND_ENVELOPE_INVALID')
      }
      const row = await updateWorkItem(
        sql,
        {
          tenantIds: [mutation.tenantId],
          actor: {
            actorType: 'agent',
            actorId: agentId,
            onBehalfOf: mutation.actor.id,
            runId,
          },
          expectedVersion: mutation.expectedVersion,
          expectedValues: mutation.snapshot,
          provenanceSource: 'agent',
          commandTransactionTail: tail,
        },
        id,
        patch,
      )
      return { id: row.id, version: row.version }
    },
  }
}
