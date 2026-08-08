import { describe, expect, it, vi } from 'vitest'

import {
  appendConversationEvent,
  authorizeConversation,
  disableActor,
  ensureActor,
  listConversationEvents,
  resolveActiveActor,
  type ActorContext,
} from './repository'

const human: ActorContext = {
  tenantId: 'tenant_1',
  kind: 'human',
  owningDomain: 'identity.user',
  owningId: 'user_1',
}

const actorRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'tenant_1',
  kind: 'human' as const,
  owning_domain: 'identity.user',
  owning_id: 'user_1',
  disabled_at: null,
}

function sqlReturning(rows: unknown[]) {
  return {
    query: vi.fn(async (_query: string, _params: unknown[]): Promise<unknown[]> => rows),
  }
}

describe('collaboration actors', () => {
  it('resolves only an active stable actor from verified owning context', async () => {
    const sql = sqlReturning([actorRow])
    expect(await resolveActiveActor(sql as never, human)).toEqual(actorRow)
    expect(sql.query.mock.calls[0]?.[1]).toEqual(['tenant_1', 'human', 'identity.user', 'user_1'])
    expect(String(sql.query.mock.calls[0]?.[0])).toMatch(/disabled_at is null/i)
  })

  it.each([
    { kind: 'agent' as const, owningDomain: 'agent.run', owningId: 'run_1' },
    { kind: 'service' as const, owningDomain: 'platform.service', owningId: 'scheduler' },
  ])('resolves $kind only from a verified server-owned reference', async (server) => {
    const context: ActorContext = { tenantId: 'tenant_1', ...server }
    const sql = sqlReturning([{ ...actorRow, kind: server.kind, owning_domain: server.owningDomain, owning_id: server.owningId }])
    expect(await resolveActiveActor(sql as never, context)).toMatchObject({ kind: server.kind })
    expect(sql.query.mock.calls[0]?.[1]).toEqual(['tenant_1', server.kind, server.owningDomain, server.owningId])
  })
  it('fails closed when the actor is missing or disabled', async () => {
    expect(await resolveActiveActor(sqlReturning([]) as never, human)).toBeNull()
    expect(await resolveActiveActor(sqlReturning([{ ...actorRow, disabled_at: new Date() }]) as never, human)).toBeNull()
  })

  it('creates by tenant owning-reference idempotently without reactivating disabled actors', async () => {
    const sql = sqlReturning([actorRow])
    expect(await ensureActor(sql as never, human)).toEqual(actorRow)
    expect(String(sql.query.mock.calls[0]?.[0])).toMatch(/on conflict \("tenant_id", "owning_domain", "owning_id"\)/i)
    expect(String(sql.query.mock.calls[0]?.[0])).not.toMatch(/disabled_at\s*=\s*null/i)
  })

  it('disables an actor idempotently within its tenant', async () => {
    const sql = sqlReturning([{ ...actorRow, disabled_at: new Date('2026-08-07T00:00:00Z') }])
    expect(await disableActor(sql as never, 'tenant_1', actorRow.id)).toMatchObject({ id: actorRow.id })
    expect(String(sql.query.mock.calls[0]?.[0])).toMatch(/coalesce\("disabled_at", now\(\)\)/i)
    expect(sql.query.mock.calls[0]?.[1]).toEqual([actorRow.id, 'tenant_1'])
  })
})

describe('conversation membership authorization', () => {
  const allowedRow = {
    actor_id: actorRow.id,
    actor_kind: 'human',
    role: 'writer',
    conversation_status: 'active',
  }

  it('allows an active actor with the required role', async () => {
    const result = await authorizeConversation(
      sqlReturning([allowedRow]) as never,
      { tenantId: 'tenant_1', conversationId: '22222222-2222-4222-8222-222222222222', actorId: actorRow.id },
      ['writer', 'admin'],
    )
    expect(result).toEqual({ ok: true, actorId: actorRow.id, actorKind: 'human', role: 'writer', conversationStatus: 'active' })
  })

  it('returns not_found for missing, disabled, removed, or cross-tenant membership', async () => {
    expect(await authorizeConversation(sqlReturning([]) as never, {
      tenantId: 'tenant_1',
      conversationId: 'foreign',
      actorId: actorRow.id,
    }, ['reader', 'writer', 'admin'])).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns forbidden for an active member without the required role', async () => {
    const result = await authorizeConversation(sqlReturning([{ ...allowedRow, role: 'reader' }]) as never, {
      tenantId: 'tenant_1', conversationId: 'conversation_1', actorId: actorRow.id,
    }, ['writer', 'admin'])
    expect(result).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('blocks ordinary writes to archived conversations', async () => {
    const result = await authorizeConversation(sqlReturning([{ ...allowedRow, conversation_status: 'archived' }]) as never, {
      tenantId: 'tenant_1', conversationId: 'conversation_1', actorId: actorRow.id,
    }, ['writer', 'admin'], { allowArchived: false })
    expect(result).toEqual({ ok: false, reason: 'archived' })
  })

  it('fails closed for archived conversations when allowArchived is omitted', async () => {
    const result = await authorizeConversation(sqlReturning([{ ...allowedRow, conversation_status: 'archived' }]) as never, {
      tenantId: 'tenant_1', conversationId: 'conversation_1', actorId: actorRow.id,
    }, ['writer', 'admin'])
    expect(result).toEqual({ ok: false, reason: 'archived' })
  })

  it('allows archived conversations only when explicitly requested', async () => {
    const result = await authorizeConversation(sqlReturning([{ ...allowedRow, conversation_status: 'archived' }]) as never, {
      tenantId: 'tenant_1', conversationId: 'conversation_1', actorId: actorRow.id,
    }, ['writer', 'admin'], { allowArchived: true })
    expect(result).toMatchObject({ ok: true, conversationStatus: 'archived' })
  })
})

const eventRow = {
  id: '33333333-3333-4333-8333-333333333333',
  tenant_id: 'tenant_1',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  actor_id: actorRow.id,
  sequence: 7,
  idempotency_key: 'request_1',
  kind: 'message.created' as const,
  payload: { text: 'hello' },
  reply_to_event_id: null,
  target_event_id: null,
  references: [{ kind: 'agent_run' as const, id: 'run_1' }],
  created_at: '2026-08-07T00:00:00.000Z',
}

function transactionalSql(result: Record<string, unknown>) {
  const query = vi.fn()
    .mockReturnValueOnce(Promise.resolve([{ id: eventRow.conversation_id }]))
    .mockReturnValueOnce(Promise.resolve([result]))
  return {
    query,
    transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  }
}

const appendInput = {
  tenantId: 'tenant_1',
  conversationId: eventRow.conversation_id,
  actorId: actorRow.id,
  idempotencyKey: eventRow.idempotency_key,
  kind: eventRow.kind,
  payload: eventRow.payload,
  references: eventRow.references,
}

describe('conversation event append', () => {
  it('returns the original event for a semantically identical retry', async () => {
    const sql = transactionalSql({ outcome: 'existing', ...eventRow })
    await expect(appendConversationEvent(sql as never, appendInput)).resolves.toEqual({
      ok: true,
      duplicate: true,
      event: eventRow,
    })
    const statement = String(sql.query.mock.calls[1]?.[0])
    expect(statement.indexOf("when e.id is not null then 'existing'")).toBeLessThan(
      statement.indexOf("when a.conversation_status = 'archived' then 'archived'"),
    )
  })

  it('rejects reuse of an idempotency key with changed semantic content', async () => {
    const sql = transactionalSql({ outcome: 'existing', ...eventRow })
    await expect(appendConversationEvent(sql as never, { ...appendInput, payload: { text: 'changed' } })).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    })
  })


it.each([
    { actorId: '55555555-5555-4555-8555-555555555555' },
    { targetEventId: '66666666-6666-4666-8666-666666666666' },
    { references: [{ kind: 'proposal' as const, id: 'proposal_1' }] },
  ])('conflicts when a retry changes author, target, or references', async (changed) => {
    const sql = transactionalSql({ outcome: 'existing', ...eventRow })
    await expect(appendConversationEvent(sql as never, { ...appendInput, ...changed })).resolves.toEqual({
      ok: false,
      reason: 'idempotency_conflict',
    })
  })
  it('issues the row lock and sequence increment in one transaction', async () => {
    const first = transactionalSql({ outcome: 'inserted', ...eventRow, sequence: 7 })
    const second = transactionalSql({ outcome: 'inserted', ...eventRow, id: '44444444-4444-4444-8444-444444444444', sequence: 8 })
    const [a, b] = await Promise.all([
      appendConversationEvent(first as never, appendInput),
      appendConversationEvent(second as never, { ...appendInput, idempotencyKey: 'request_2' }),
    ])
    expect([a, b]).toMatchObject([
      { ok: true, duplicate: false, event: { sequence: 7 } },
      { ok: true, duplicate: false, event: { sequence: 8 } },
    ])
    expect(String(first.query.mock.calls[0]?.[0])).toMatch(/for update/i)
    expect(String(first.query.mock.calls[1]?.[0])).toMatch(/next_sequence\s*=\s*c\.next_sequence\s*\+\s*1/i)
    expect(first.transaction).toHaveBeenCalledOnce()
  })

  it.each(['not_found', 'forbidden', 'archived', 'invalid_reference'] as const)(
    'maps the %s outcome to its reason',
    async (outcome) => {
      const sql = transactionalSql({ outcome })
      await expect(appendConversationEvent(sql as never, appendInput)).resolves.toEqual({ ok: false, reason: outcome })
      expect(String(sql.query.mock.calls[1]?.[0])).toMatch(/valid_links/i)
    },
  )


it('requires admin authorization for membership events', async () => {
    const sql = transactionalSql({ outcome: 'forbidden' })
    await expect(appendConversationEvent(sql as never, {
      ...appendInput,
      kind: 'membership.added',
    })).resolves.toEqual({ ok: false, reason: 'forbidden' })
    expect(String(sql.query.mock.calls[1]?.[0])).toMatch(/membership\.added[\s\S]*a\.role\s*=\s*'admin'/i)
  })
  it('sends edit, delete, and reply links through same-conversation validation', async () => {
    const sql = transactionalSql({ outcome: 'invalid_reference' })
    await appendConversationEvent(sql as never, {
      ...appendInput,
      kind: 'message.edited',
      replyToEventId: eventRow.id,
      targetEventId: eventRow.id,
    })
    const statement = String(sql.query.mock.calls[1]?.[0])
    expect(statement).toMatch(/reply_to_event_id/i)
    expect(statement).toMatch(/target_event_id/i)
    expect(statement).toMatch(/message\.deleted/i)
  })
})

describe('conversation event cursor reads', () => {
  it('authorizes and resumes exclusively in ascending sequence order', async () => {
    const sql = {
      query: vi.fn()
        .mockResolvedValueOnce([{ actor_id: actorRow.id, actor_kind: 'human', role: 'reader', conversation_status: 'active' }])
        .mockResolvedValueOnce([{ ...eventRow, sequence: 8 }, { ...eventRow, sequence: 9 }]),
    }
    await expect(listConversationEvents(sql as never, {
      tenantId: 'tenant_1',
      conversationId: eventRow.conversation_id,
      actorId: actorRow.id,
      afterSequence: 7,
      limit: 50,
    })).resolves.toMatchObject({ ok: true, events: [{ sequence: 8 }, { sequence: 9 }] })
    expect(String(sql.query.mock.calls[1]?.[0])).toMatch(/sequence\s*>\s*\$3[\s\S]*order by sequence asc/i)
    expect(sql.query.mock.calls[1]?.[1]).toEqual(['tenant_1', eventRow.conversation_id, 7, 50])
  })

  it('fails closed before reading events when membership is absent', async () => {
    const sql = { query: vi.fn().mockResolvedValueOnce([]) }
    await expect(listConversationEvents(sql as never, {
      tenantId: 'tenant_1', conversationId: 'foreign', actorId: actorRow.id, afterSequence: 0,
    })).resolves.toEqual({ ok: false, reason: 'not_found' })
    expect(sql.query).toHaveBeenCalledOnce()
  })
})
