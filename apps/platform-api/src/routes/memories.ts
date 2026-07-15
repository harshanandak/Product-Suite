import { Hono } from 'hono'

import type { AuthClaims } from '@product-suite/contracts'

import { callerTenantIds, callerUserId } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import { DomainError, domainErrorStatus } from '../domain/errors'
import {
  createMemory,
  deferMemory,
  getMemoryChain,
  getMemoryScoped,
  listMemories,
  retractMemory,
  supersedeMemory,
  type CreateMemoryInput,
  type ListMemoriesFilter,
  type MemoryRow,
} from '../domain/memories'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * Memory Brain P1 routes (see docs/design/2026-07-15-memory-brain-p1.md). The
 * human-authored decision/knowledge store — logging a decision is active IMMEDIATELY
 * (no self-review; the capture-friction keystone). Everything is TENANT-SCOPED — a
 * SECURITY boundary: a foreign/unknown memory id resolves to 404, never a leak, and a
 * memory anchors to ONE org. Reads span the caller's orgs (scoped by `any(tenantIds)`);
 * a create anchors to a single resolved org.
 */
export const memoriesRoutes = new Hono<AuthedEnv>()

/**
 * Resolve the single org a create anchors to: the requested `org_id` when the caller
 * belongs to it, else their sole org, else ambiguous. Mirrors the chat/threads routes
 * so a memory's org is never guessed.
 */
function resolveAnchor(
  tenantIds: string[],
  orgId: string | undefined,
): { ok: true; tenantId: string } | { ok: false } {
  if (orgId && tenantIds.includes(orgId)) return { ok: true, tenantId: orgId }
  if (orgId) return { ok: false }
  if (tenantIds.length === 1) return { ok: true, tenantId: tenantIds[0]! }
  return { ok: false }
}

/** Whitelist an enum-ish query param: return it only when it is one of `allowed`. */
function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/**
 * The Decision Log / Topic list: an org's memories with optional filters (kind,
 * status, topic, scope, FTS `q`). Scoped to the caller's tenants — another org's
 * memory is invisible. Empty (not an error) when the caller is in no org.
 */
memoriesRoutes.get('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json([])
    const filter: ListMemoriesFilter = {
      kind: pick(c.req.query('kind'), ['decision', 'fact', 'rule'] as const),
      status: pick(c.req.query('status'), ['active', 'superseded', 'retracted', 'deferred'] as const),
      scopeType: pick(c.req.query('scope_type'), ['org', 'project', 'work_item_type', 'work_item'] as const),
      scopeId: c.req.query('scope_id') || undefined,
      topic: c.req.query('topic') || undefined,
      q: c.req.query('q') || undefined,
    }
    const rows = await listMemories(sql, tenantIds, filter)
    return c.json(rows)
  } catch (cause) {
    console.error('[memories] list failed', cause)
    return c.json({ error: 'Failed to load memories' }, 500)
  }
})

/**
 * One memory + its full supersession chain ("replaced by … because …"). Tenant-
 * checked: a memory that is not the caller's ⇒ 404 (never a leak). The chain is
 * resolved by `root_id` within the caller's tenants.
 */
memoriesRoutes.get('/:id', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'Not found' }, 404)
    const memory = await getMemoryScoped(sql, id, tenantIds)
    if (!memory) return c.json({ error: 'Not found' }, 404)
    const chain = await getMemoryChain(sql, memory.root_id, tenantIds)
    return c.json({ memory, chain })
  } catch (cause) {
    console.error('[memories] get failed', cause)
    return c.json({ error: 'Failed to load memory' }, 500)
  }
})

/** The body a create accepts (org_id optional; the rest maps to CreateMemoryInput). */
interface CreateBody extends Partial<CreateMemoryInput> {
  org_id?: string
}

/**
 * Log a new memory — active IMMEDIATELY (no review; the capture-friction keystone).
 * Anchors to ONE resolved org. `kind` + `title` are required; the actor
 * (`created_by`) is the server-derived caller, never trusted from the body.
 */
memoriesRoutes.post('/', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const body = (await c.req.json().catch(() => ({}))) as CreateBody

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'No active organization' }, 403)
    const anchor = resolveAnchor(tenantIds, body.org_id)
    if (!anchor.ok) return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)

    const kind = pick(body.kind, ['decision', 'fact', 'rule'] as const)
    if (!kind) return c.json({ error: 'kind must be one of decision, fact, rule' }, 400)
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return c.json({ error: 'title is required' }, 400)
    }

    const actor = await callerUserId(sql, claims)
    if (!actor) {
      console.error('[memories] tenant resolved but no user identity for subject')
      return c.json({ error: 'Failed to create memory' }, 500)
    }

    const created = await createMemory(
      sql,
      { tenantId: anchor.tenantId, actor },
      {
        kind,
        title: body.title,
        body: body.body,
        attrs: body.attrs,
        scopeType: body.scopeType,
        scopeId: body.scopeId ?? null,
        topics: Array.isArray(body.topics) ? body.topics : undefined,
        sourceKind: body.sourceKind,
        sourceQuote: body.sourceQuote ?? null,
        decidedBy: body.decidedBy ?? null,
      },
    )
    return c.json(created, 201)
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[memories] create failed', cause)
    return c.json({ error: 'Failed to create memory' }, 500)
  }
})

/** Resolve the caller's tenants + actor for a scoped mutation; 404/500 shortcuts. */
async function mutationContext(
  sql: ReturnType<typeof sqlFrom>,
  claims: AuthClaims,
): Promise<{ ok: true; tenantIds: string[]; actor: string } | { ok: false; status: 404 | 500 }> {
  const tenantIds = await callerTenantIds(sql, claims)
  if (tenantIds.length === 0) return { ok: false, status: 404 }
  const actor = await callerUserId(sql, claims)
  if (!actor) {
    console.error('[memories] tenant resolved but no user identity for subject')
    return { ok: false, status: 500 }
  }
  return { ok: true, tenantIds, actor }
}

/**
 * Supersede a memory — inserts a NEW version + latches the old (append-only).
 * `change_reason` is MANDATORY. Foreign/unknown id ⇒ 404; a lost race ⇒ 409.
 */
memoriesRoutes.post('/:id/supersede', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string
    body?: string
    topics?: string[]
    change_reason?: string
  }

  try {
    const ctx = await mutationContext(sql, claims)
    if (!ctx.ok) return c.json({ error: ctx.status === 404 ? 'Not found' : 'Failed to supersede' }, ctx.status)
    const updated = await supersedeMemory(
      sql,
      { tenantIds: ctx.tenantIds, actor: ctx.actor },
      id,
      {
        title: body.title,
        body: body.body,
        topics: Array.isArray(body.topics) ? body.topics : undefined,
        changeReason: body.change_reason ?? '',
      },
    )
    return c.json(updated)
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[memories] supersede failed', cause)
    return c.json({ error: 'Failed to supersede memory' }, 500)
  }
})

/** Retract a memory (mis-record correction) — status→retracted, row kept. */
memoriesRoutes.post('/:id/retract', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')

  try {
    const ctx = await mutationContext(sql, claims)
    if (!ctx.ok) return c.json({ error: ctx.status === 404 ? 'Not found' : 'Failed to retract' }, ctx.status)
    const updated = await retractMemory(sql, { tenantIds: ctx.tenantIds, actor: ctx.actor }, id)
    return c.json(updated)
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[memories] retract failed', cause)
    return c.json({ error: 'Failed to retract memory' }, 500)
  }
})

/** Defer a memory (park it with waiting_on / review_after) — status→deferred, row kept. */
memoriesRoutes.post('/:id/defer', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as {
    waiting_on?: string
    review_after?: string
  }

  try {
    const ctx = await mutationContext(sql, claims)
    if (!ctx.ok) return c.json({ error: ctx.status === 404 ? 'Not found' : 'Failed to defer' }, ctx.status)
    const updated = await deferMemory(
      sql,
      { tenantIds: ctx.tenantIds, actor: ctx.actor },
      id,
      { waitingOn: body.waiting_on ?? null, reviewAfter: body.review_after ?? null },
    )
    return c.json(updated)
  } catch (cause) {
    if (cause instanceof DomainError) {
      return c.json({ error: cause.message }, domainErrorStatus(cause.code))
    }
    console.error('[memories] defer failed', cause)
    return c.json({ error: 'Failed to defer memory' }, 500)
  }
})

export type { MemoryRow }
