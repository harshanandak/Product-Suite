import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { appendConversationEvent, listConversationEvents } from '../../src/collaboration/repository'
import { hasNeonCreds, query, withDbBranch } from './harness'

const DB_CONTRACT_TIMEOUT_MS = 180_000

describe.skipIf(!hasNeonCreds())(
  'db-contract: collaboration authority (real Neon branch)',
  { timeout: DB_CONTRACT_TIMEOUT_MS },
  () => {
    it('enforces idempotency, ordering, cursor, ACL, references, links, archive, and immutability', async () => {
      await withDbBranch(async ({ sql, seed }) => {
        const actorId = randomUUID()
        const conversationId = randomUUID()
        await query(
          sql,
          `insert into collaboration_actors (id, tenant_id, kind, owning_domain, owning_id)
           values ($1, $2, 'human', 'identity.user', $3)`,
          [actorId, seed.tenantId, seed.userId],
        )
        await query(
          sql,
          `insert into conversations (id, tenant_id, title, created_by_actor_id)
           values ($1, $2, 'Contract conversation', $3)`,
          [conversationId, seed.tenantId, actorId],
        )
        await query(
          sql,
          `insert into conversation_memberships (
             tenant_id, conversation_id, actor_id, role, status, created_by_actor_id
           ) values ($1, $2, $3, 'admin', 'active', $3)`,
          [seed.tenantId, conversationId, actorId],
        )

        const references = [
          { kind: 'agent_run' as const, id: seed.runId },
          { kind: 'proposal' as const, id: randomUUID() },
          { kind: 'approval' as const, id: randomUUID() },
          { kind: 'schedule' as const, id: randomUUID() },
          { kind: 'meeting' as const, id: randomUUID() },
          { kind: 'work_item' as const, id: randomUUID() },
          { kind: 'canvas_document' as const, id: randomUUID() },
        ]
        const baseInput = {
          tenantId: seed.tenantId,
          conversationId,
          actorId,
          idempotencyKey: 'contract-base',
          kind: 'message.created' as const,
          payload: { text: 'base' },
          references,
        }
        const first = await appendConversationEvent(sql, baseInput)
        expect(first).toMatchObject({ ok: true, duplicate: false, event: { sequence: 1, references } })
        if (!first.ok) throw new Error('unreachable')

        const retry = await appendConversationEvent(sql, baseInput)
        expect(retry).toMatchObject({ ok: true, duplicate: true, event: { id: first.event.id, sequence: 1 } })
        expect(await appendConversationEvent(sql, { ...baseInput, payload: { text: 'changed' } }))
          .toEqual({ ok: false, reason: 'idempotency_conflict' })

        const concurrent = await Promise.all([
          appendConversationEvent(sql, { ...baseInput, idempotencyKey: 'contract-2', payload: { text: 'two' }, references: [] }),
          appendConversationEvent(sql, { ...baseInput, idempotencyKey: 'contract-3', payload: { text: 'three' }, references: [] }),
        ])
        const sequences = concurrent.flatMap((result) => result.ok ? [result.event.sequence] : []).sort((a, b) => a - b)
        expect(sequences).toEqual([2, 3])

        const cursor = await listConversationEvents(sql, {
          tenantId: seed.tenantId, conversationId, actorId, afterSequence: 1,
        })
        expect(cursor.ok).toBe(true)
        if (!cursor.ok) throw new Error('unreachable')
        expect(cursor.events.map((event) => event.sequence)).toEqual([2, 3])

        expect(await appendConversationEvent(sql, {
          ...baseInput,
          idempotencyKey: 'bad-edit',
          kind: 'message.edited',
          targetEventId: randomUUID(),
        })).toEqual({ ok: false, reason: 'invalid_reference' })
        const edit = await appendConversationEvent(sql, {
          ...baseInput,
          idempotencyKey: 'edit',
          kind: 'message.edited',
          targetEventId: first.event.id,
          payload: { text: 'edited' },
          references: [],
        })
        expect(edit).toMatchObject({ ok: true, event: { sequence: 4 } })
        if (!edit.ok) throw new Error('unreachable')
        const deletion = await appendConversationEvent(sql, {
          ...baseInput,
          idempotencyKey: 'delete',
          kind: 'message.deleted',
          targetEventId: edit.event.id,
          payload: {},
          references: [],
        })
        expect(deletion).toMatchObject({ ok: true, event: { sequence: 5 } })
        expect(await appendConversationEvent(sql, {
          ...baseInput,
          idempotencyKey: 'delete-again',
          kind: 'message.deleted',
          targetEventId: edit.event.id,
          payload: {},
          references: [],
        })).toEqual({ ok: false, reason: 'invalid_reference' })
        expect(await appendConversationEvent(sql, {
          ...baseInput,
          idempotencyKey: 'reply-deleted',
          replyToEventId: edit.event.id,
          references: [],
        })).toEqual({ ok: false, reason: 'invalid_reference' })

        const foreignActor = randomUUID()
        const foreignTenant = randomUUID()
        await query(sql, `insert into tenants (id, slug, name) values ($1, $2, 'Foreign')`, [
          foreignTenant,
          `contract-${foreignTenant}`,
        ])
        await query(
          sql,
          `insert into collaboration_actors (id, tenant_id, kind, owning_domain, owning_id)
           values ($1, $2, 'service', 'contract', 'foreign')`,
          [foreignActor, foreignTenant],
        )
        expect(await appendConversationEvent(sql, { ...baseInput, idempotencyKey: 'foreign', actorId: foreignActor }))
          .toEqual({ ok: false, reason: 'not_found' })

        await query(sql, `update conversations set status = 'archived' where id = $1`, [conversationId])
        expect(await appendConversationEvent(sql, { ...baseInput, idempotencyKey: 'archived' }))
          .toEqual({ ok: false, reason: 'archived' })
        expect((await listConversationEvents(sql, {
          tenantId: seed.tenantId, conversationId, actorId, afterSequence: 0,
        })).ok).toBe(true)

        await expect(query(sql, `update conversation_events set payload = '{}'::jsonb where id = $1`, [first.event.id]))
          .rejects.toThrow(/immutable/i)

        await query(sql, `update collaboration_actors set disabled_at = now() where id = $1`, [actorId])
        expect(await listConversationEvents(sql, {
          tenantId: seed.tenantId, conversationId, actorId, afterSequence: 0,
        })).toEqual({ ok: false, reason: 'not_found' })
        await query(sql, `update collaboration_actors set disabled_at = null where id = $1`, [actorId])
        await query(
          sql,
          `update conversation_memberships set status = 'removed'
           where tenant_id = $1 and conversation_id = $2 and actor_id = $3`,
          [seed.tenantId, conversationId, actorId],
        )
        expect(await listConversationEvents(sql, {
          tenantId: seed.tenantId, conversationId, actorId, afterSequence: 0,
        })).toEqual({ ok: false, reason: 'not_found' })
      })
    })
  },
)
