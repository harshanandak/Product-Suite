import { describe, expect, it, vi } from 'vitest'

import {
  authorizeConversation,
  disableActor,
  ensureActor,
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
})