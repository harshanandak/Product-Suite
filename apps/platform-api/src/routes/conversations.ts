import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { AuthClaims } from '@product-suite/contracts'
import type { Sql } from '@product-suite/db'

import { resolveHumanActorContext } from '../auth/tenant-scope'
import {
  appendConversationEvent,
  authorizeConversation,
  listConversationEvents,
  resolveActiveActor,
  type ActorRow,
  type ConversationEventRow,
} from '../collaboration/repository'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

const tenantSchema = z.string().min(1).max(200)
const uuidSchema = z.string().uuid()
const referenceSchema = z.object({
  kind: z.enum(['agent_run', 'proposal', 'approval', 'schedule', 'meeting', 'work_item', 'canvas_document']),
  id: z.string().min(1).max(500),
}).strict()
const appendSchema = z.object({
  tenant_id: tenantSchema,
  idempotency_key: z.string().min(1).max(200),
  kind: z.enum([
    'message.created', 'message.edited', 'message.deleted',
    'membership.added', 'membership.changed', 'membership.removed',
  ]),
  payload: z.unknown().optional(),
  reply_to_event_id: uuidSchema.nullable().optional(),
  target_event_id: uuidSchema.nullable().optional(),
  references: z.array(referenceSchema).max(100).optional(),
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value.payload ?? {})).byteLength > 262_144) {
    context.addIssue({ code: 'custom', message: 'payload is too large', path: ['payload'] })
  }
  if (new TextEncoder().encode(JSON.stringify(value.references ?? [])).byteLength > 65_536) {
    context.addIssue({ code: 'custom', message: 'references are too large', path: ['references'] })
  }
  if (containsSensitiveKey(value.payload)) {
    context.addIssue({ code: 'custom', message: 'payload contains a sensitive field', path: ['payload'] })
  }
})
const membershipSchema = z.object({
  tenant_id: tenantSchema,
  target_actor_id: uuidSchema,
  role: z.enum(['reader', 'writer', 'admin']),
  status: z.enum(['active', 'removed']),
  idempotency_key: z.string().min(1).max(200),
}).strict()

interface ConversationRow {
  id: string
  tenant_id: string
  title: string
  status: 'active' | 'archived'
  subject_ref?: unknown
  created_at?: string | Date
  updated_at?: string | Date
}

function containsSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => /(^|_)(authorization|cookie|password|secret|token)($|_)/i.test(key) || containsSensitiveKey(nested),
  )
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (query: string, params: unknown[]) => Promise<Row[]> }).query(text, params)
}

async function callerActor(sql: Sql, claims: AuthClaims, tenantId: string): Promise<ActorRow | null> {
  const context = await resolveHumanActorContext(sql, claims, tenantId)
  return context ? resolveActiveActor(sql, context) : null
}

async function parsedBody(c: Context<AuthedEnv>): Promise<unknown | null> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}

function failureStatus(reason: 'not_found' | 'forbidden' | 'archived' | 'invalid_reference' | 'idempotency_conflict') {
  if (reason === 'not_found') return 404 as const
  if (reason === 'forbidden') return 403 as const
  if (reason === 'invalid_reference') return 400 as const
  return 409 as const
}

interface MembershipTransactionRow extends Partial<ConversationEventRow> {
  outcome: 'inserted' | 'existing' | 'not_found' | 'forbidden' | 'archived' | 'failed'
  semantic_match?: boolean
}

async function mutateMembership(
  sql: Sql,
  input: {
    tenantId: string
    conversationId: string
    actorId: string
    targetActorId: string
    role: 'reader' | 'writer' | 'admin'
    status: 'active' | 'removed'
    idempotencyKey: string
  },
): Promise<{ ok: true; event: Omit<MembershipTransactionRow, 'outcome' | 'semantic_match'> } | { ok: false; reason: 'not_found' | 'forbidden' | 'archived' | 'idempotency_conflict' }> {
  const client = sql as unknown as {
    query: (query: string, params: unknown[]) => unknown
    transaction: (queries: unknown[], options: { isolationLevel: 'ReadCommitted' }) => Promise<unknown[][]>
  }
  const payload = {
    target_actor_id: input.targetActorId,
    role: input.role,
    status: input.status,
  }
  const lock = client.query(
    'select id from "conversations" where tenant_id = $1 and id = $2 for update',
    [input.tenantId, input.conversationId],
  )
  const mutation = client.query(
    `with authorization as materialized (
       select a.id as actor_id, m.role, c.status as conversation_status
       from "collaboration_actors" a
       join "conversation_memberships" m
         on m.tenant_id = a.tenant_id and m.actor_id = a.id and m.status = 'active'
       join "conversations" c
         on c.tenant_id = m.tenant_id and c.id = m.conversation_id
       where a.tenant_id = $1 and c.id = $2 and a.id = $3 and a.disabled_at is null
       limit 1
     ), existing as materialized (
       select e.* from "conversation_events" e
       where e.tenant_id = $1 and e.conversation_id = $2 and e.idempotency_key = $4
       limit 1
     ), target as materialized (
       select id from "collaboration_actors"
       where tenant_id = $1 and id = $5 and disabled_at is null
     ), current_membership as materialized (
       select status from "conversation_memberships"
       where tenant_id = $1 and conversation_id = $2 and actor_id = $5
     ), allocated as materialized (
       update "conversations" c set next_sequence = c.next_sequence + 1, updated_at = now()
       from authorization a, target t
       where c.tenant_id = $1 and c.id = $2 and c.status = 'active' and a.role = 'admin'
         and not exists (select 1 from existing)
       returning c.next_sequence - 1 as sequence
     ), membership_write as materialized (
       insert into "conversation_memberships" (
         tenant_id, conversation_id, actor_id, role, status, created_by_actor_id
       )
       select $1, $2::uuid, $5::uuid, $6::conversation_membership_role,
         $7::conversation_membership_status, $3::uuid from allocated
       on conflict (tenant_id, conversation_id, actor_id) do update
       set role = excluded.role, status = excluded.status, updated_at = now()
       returning actor_id
     ), inserted as materialized (
       insert into "conversation_events" (
         tenant_id, conversation_id, actor_id, sequence, idempotency_key, kind, payload, references
       )
       select $1, $2::uuid, $3::uuid, allocated.sequence, $4,
         case
           when $7::text = 'removed' then 'membership.removed'::conversation_event_kind
           when not exists (select 1 from current_membership) then 'membership.added'::conversation_event_kind
           else 'membership.changed'::conversation_event_kind
         end,
         $8::jsonb, '[]'::jsonb
       from allocated, membership_write
       returning *
     )
     select
       case
         when a.actor_id is null or t.id is null then 'not_found'
         when a.role <> 'admin' then 'forbidden'
         when a.conversation_status = 'archived' then 'archived'
         when e.id is not null then 'existing'
         when i.id is not null then 'inserted'
         else 'failed'
       end as outcome,
       (e.actor_id = $3::uuid and e.kind in ('membership.added', 'membership.changed', 'membership.removed') and e.payload = $8::jsonb) as semantic_match,
       coalesce(i.id, e.id) as id,
       coalesce(i.tenant_id, e.tenant_id) as tenant_id,
       coalesce(i.conversation_id, e.conversation_id) as conversation_id,
       coalesce(i.actor_id, e.actor_id) as actor_id,
       coalesce(i.sequence, e.sequence) as sequence,
       coalesce(i.idempotency_key, e.idempotency_key) as idempotency_key,
       coalesce(i.kind, e.kind) as kind,
       coalesce(i.payload, e.payload) as payload,
       coalesce(i.reply_to_event_id, e.reply_to_event_id) as reply_to_event_id,
       coalesce(i.target_event_id, e.target_event_id) as target_event_id,
       coalesce(i.references, e.references) as references,
       coalesce(i.created_at, e.created_at) as created_at
     from (values (1)) as seed(n)
     left join authorization a on true
     left join target t on true
     left join existing e on true
     left join inserted i on true`,
    [input.tenantId, input.conversationId, input.actorId, input.idempotencyKey, input.targetActorId, input.role, input.status, JSON.stringify(payload)],
  )
  const results = await client.transaction([lock, mutation], { isolationLevel: 'ReadCommitted' })
  const row = results[1]?.[0] as MembershipTransactionRow | undefined
  if (!row || row.outcome === 'failed') throw new Error('mutateMembership: transaction returned no outcome')
  if (row.outcome === 'existing' && row.semantic_match !== true) return { ok: false, reason: 'idempotency_conflict' }
  if (row.outcome !== 'inserted' && row.outcome !== 'existing') return { ok: false, reason: row.outcome }
  const { outcome: _outcome, semantic_match: _semanticMatch, ...event } = row
  return { ok: true, event }
}

export const conversationsRoutes = new Hono<AuthedEnv>()

conversationsRoutes.get('/', async (c) => {
  const tenant = tenantSchema.safeParse(c.req.query('tenant_id'))
  if (!tenant.success) return c.json({ error: 'Invalid tenant_id' }, 400)
  const sql = sqlFrom(c.env ?? {})
  try {
    const actor = await callerActor(sql, c.get('claims'), tenant.data)
    if (!actor) return c.json({ error: 'Not found' }, 404)
    const rows = await runQuery<ConversationRow>(sql,
      `select c.id, c.tenant_id, c.title, c.status, c.subject_ref, c.created_at, c.updated_at
       from "conversations" c
       join "conversation_memberships" m
         on m.tenant_id = c.tenant_id and m.conversation_id = c.id and m.status = 'active'
       where c.tenant_id = $1 and m.actor_id = $2
       order by c.updated_at desc`,
      [tenant.data, actor.id],
    )
    return c.json(rows)
  } catch (cause) {
    console.error('[conversations] list failed', cause)
    return c.json({ error: 'Failed to load conversations' }, 500)
  }
})

conversationsRoutes.get('/:id', async (c) => {
  const tenant = tenantSchema.safeParse(c.req.query('tenant_id'))
  const id = uuidSchema.safeParse(c.req.param('id'))
  if (!tenant.success || !id.success) return c.json({ error: 'Invalid request' }, 400)
  const sql = sqlFrom(c.env ?? {})
  try {
    const actor = await callerActor(sql, c.get('claims'), tenant.data)
    if (!actor) return c.json({ error: 'Not found' }, 404)
    const access = await authorizeConversation(sql, { tenantId: tenant.data, conversationId: id.data, actorId: actor.id }, ['reader', 'writer', 'admin'])
    if (!access.ok) return c.json({ error: access.reason === 'forbidden' ? 'Forbidden' : 'Not found' }, failureStatus(access.reason))
    const rows = await runQuery<ConversationRow>(sql,
      `select id, tenant_id, title, status, subject_ref, created_at, updated_at
       from "conversations" where tenant_id = $1 and id = $2 limit 1`,
      [tenant.data, id.data],
    )
    return rows[0] ? c.json(rows[0]) : c.json({ error: 'Not found' }, 404)
  } catch (cause) {
    console.error('[conversations] get failed', cause)
    return c.json({ error: 'Failed to load conversation' }, 500)
  }
})

conversationsRoutes.get('/:id/events', async (c) => {
  const input = z.object({
    tenant_id: tenantSchema,
    after_sequence: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }).safeParse(c.req.query())
  const id = uuidSchema.safeParse(c.req.param('id'))
  if (!input.success || !id.success) return c.json({ error: 'Invalid request' }, 400)
  const sql = sqlFrom(c.env ?? {})
  try {
    const actor = await callerActor(sql, c.get('claims'), input.data.tenant_id)
    if (!actor) return c.json({ error: 'Not found' }, 404)
    const result = await listConversationEvents(sql, {
      tenantId: input.data.tenant_id,
      conversationId: id.data,
      actorId: actor.id,
      afterSequence: input.data.after_sequence,
      limit: input.data.limit,
    })
    return result.ok
      ? c.json({ events: result.events })
      : c.json({ error: result.reason === 'forbidden' ? 'Forbidden' : 'Not found' }, failureStatus(result.reason))
  } catch (cause) {
    console.error('[conversations] event read failed', cause)
    return c.json({ error: 'Failed to load conversation events' }, 500)
  }
})

conversationsRoutes.post('/:id/events', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'))
  const body = appendSchema.safeParse(await parsedBody(c))
  if (!id.success || !body.success) return c.json({ error: 'Invalid request' }, 400)
  const sql = sqlFrom(c.env ?? {})
  try {
    const actor = await callerActor(sql, c.get('claims'), body.data.tenant_id)
    if (!actor) return c.json({ error: 'Not found' }, 404)
    const result = await appendConversationEvent(sql, {
      tenantId: body.data.tenant_id,
      conversationId: id.data,
      actorId: actor.id,
      idempotencyKey: body.data.idempotency_key,
      kind: body.data.kind,
      payload: body.data.payload,
      replyToEventId: body.data.reply_to_event_id,
      targetEventId: body.data.target_event_id,
      references: body.data.references,
    })
    return result.ok
      ? c.json({ event: result.event, duplicate: result.duplicate }, result.duplicate ? 200 : 201)
      : c.json({ error: result.reason }, failureStatus(result.reason))
  } catch (cause) {
    console.error('[conversations] event append failed', cause)
    return c.json({ error: 'Failed to append conversation event' }, 500)
  }
})

conversationsRoutes.post('/:id/memberships', async (c) => {
  const id = uuidSchema.safeParse(c.req.param('id'))
  const body = membershipSchema.safeParse(await parsedBody(c))
  if (!id.success || !body.success) return c.json({ error: 'Invalid request' }, 400)
  const sql = sqlFrom(c.env ?? {})
  try {
    const actor = await callerActor(sql, c.get('claims'), body.data.tenant_id)
    if (!actor) return c.json({ error: 'Not found' }, 404)
    const access = await authorizeConversation(sql, {
      tenantId: body.data.tenant_id, conversationId: id.data, actorId: actor.id,
    }, ['admin'], { allowArchived: false })
    if (!access.ok) return c.json({ error: access.reason }, failureStatus(access.reason))
    const result = await mutateMembership(sql, {
      tenantId: body.data.tenant_id,
      conversationId: id.data,
      actorId: actor.id,
      targetActorId: body.data.target_actor_id,
      role: body.data.role,
      status: body.data.status,
      idempotencyKey: body.data.idempotency_key,
    })
    return result.ok
      ? c.json({ event: result.event }, 200)
      : c.json({ error: result.reason }, failureStatus(result.reason))
  } catch (cause) {
    console.error('[conversations] membership mutation failed', cause)
    return c.json({ error: 'Failed to mutate conversation membership' }, 500)
  }
})