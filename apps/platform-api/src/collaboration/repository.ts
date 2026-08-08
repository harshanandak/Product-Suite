import type { Sql } from '@product-suite/db'

export type ActorKind = 'human' | 'agent' | 'service'
export type ConversationRole = 'reader' | 'writer' | 'admin'
export type ConversationStatus = 'active' | 'archived'

export interface ActorContext {
  tenantId: string
  kind: ActorKind
  owningDomain: string
  owningId: string
}

export interface ActorRow {
  id: string
  tenant_id: string
  kind: ActorKind
  owning_domain: string
  owning_id: string
  disabled_at: string | Date | null
}

interface AuthorizationRow {
  actor_id: string
  actor_kind: ActorKind
  role: ConversationRole
  conversation_status: ConversationStatus
}

export type ConversationAuthorization =
  | {
      ok: true
      actorId: string
      actorKind: ActorKind
      role: ConversationRole
      conversationStatus: ConversationStatus
    }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'archived' }

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (query: string, params: unknown[]) => Promise<Row[]> }).query(text, params)
}

export async function resolveActiveActor(sql: Sql, context: ActorContext): Promise<ActorRow | null> {
  const rows = await runQuery<ActorRow>(
    sql,
    `select id, tenant_id, kind, owning_domain, owning_id, disabled_at
     from "collaboration_actors"
     where tenant_id = $1 and kind = $2 and owning_domain = $3 and owning_id = $4
       and disabled_at is null
     limit 1`,
    [context.tenantId, context.kind, context.owningDomain, context.owningId],
  )
  const actor = rows[0]
  return actor?.disabled_at === null ? actor : null
}

export async function ensureActor(sql: Sql, context: ActorContext): Promise<ActorRow> {
  const rows = await runQuery<ActorRow>(
    sql,
    `insert into "collaboration_actors" ("tenant_id", "kind", "owning_domain", "owning_id")
     values ($1, $2, $3, $4)
     on conflict ("tenant_id", "owning_domain", "owning_id")
     do update set "updated_at" = "collaboration_actors"."updated_at"
     returning id, tenant_id, kind, owning_domain, owning_id, disabled_at`,
    [context.tenantId, context.kind, context.owningDomain, context.owningId],
  )
  const actor = rows[0]
  if (!actor) throw new Error('ensureActor: insert returned no actor')
  if (actor.kind !== context.kind) throw new Error('ensureActor: owning reference belongs to another actor kind')
  return actor
}

export async function disableActor(sql: Sql, tenantId: string, actorId: string): Promise<ActorRow | null> {
  const rows = await runQuery<ActorRow>(
    sql,
    `update "collaboration_actors"
     set "disabled_at" = coalesce("disabled_at", now()), "updated_at" = now()
     where "id" = $1 and "tenant_id" = $2
     returning id, tenant_id, kind, owning_domain, owning_id, disabled_at`,
    [actorId, tenantId],
  )
  return rows[0] ?? null
}

export async function authorizeConversation(
  sql: Sql,
  input: { tenantId: string; conversationId: string; actorId: string },
  allowedRoles: readonly ConversationRole[],
  options: { allowArchived?: boolean } = {},
): Promise<ConversationAuthorization> {
  const rows = await runQuery<AuthorizationRow>(
    sql,
    `select a.id as actor_id, a.kind as actor_kind, m.role, c.status as conversation_status
     from "collaboration_actors" a
     join "conversation_memberships" m
       on m.tenant_id = a.tenant_id and m.actor_id = a.id and m.status = 'active'
     join "conversations" c
       on c.tenant_id = m.tenant_id and c.id = m.conversation_id
     where a.tenant_id = $1 and c.id = $2 and a.id = $3 and a.disabled_at is null
     limit 1`,
    [input.tenantId, input.conversationId, input.actorId],
  )
  const row = rows[0]
  if (!row) return { ok: false, reason: 'not_found' }
  if (!allowedRoles.includes(row.role)) return { ok: false, reason: 'forbidden' }
  if (row.conversation_status === 'archived' && options.allowArchived === false) {
    return { ok: false, reason: 'archived' }
  }
  return {
    ok: true,
    actorId: row.actor_id,
    actorKind: row.actor_kind,
    role: row.role,
    conversationStatus: row.conversation_status,
  }
}

export type ConversationEventKind =
  | 'message.created'
  | 'message.edited'
  | 'message.deleted'
  | 'membership.added'
  | 'membership.changed'
  | 'membership.removed'

export type ConversationReferenceKind =
  | 'agent_run'
  | 'proposal'
  | 'approval'
  | 'schedule'
  | 'meeting'
  | 'work_item'
  | 'canvas_document'

export interface ConversationReference {
  kind: ConversationReferenceKind
  id: string
}

export interface ConversationEventRow {
  id: string
  tenant_id: string
  conversation_id: string
  actor_id: string
  sequence: number
  idempotency_key: string
  kind: ConversationEventKind
  payload: unknown
  reply_to_event_id: string | null
  target_event_id: string | null
  references: ConversationReference[]
  created_at: string | Date
}

export interface AppendConversationEventInput {
  tenantId: string
  conversationId: string
  actorId: string
  idempotencyKey: string
  kind: ConversationEventKind
  payload?: unknown
  replyToEventId?: string | null
  targetEventId?: string | null
  references?: readonly ConversationReference[]
}

type ConversationAuthorizationFailure = Extract<ConversationAuthorization, { ok: false }>

export type AppendConversationEventResult =
  | { ok: true; duplicate: boolean; event: ConversationEventRow }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'archived' | 'invalid_reference' | 'idempotency_conflict' }

interface AppendTransactionRow extends Partial<ConversationEventRow> {
  outcome: 'inserted' | 'existing' | 'not_found' | 'forbidden' | 'archived' | 'invalid_reference' | 'failed'
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const entries = Object.keys(object)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [JSON.stringify(key), canonicalJson(object[key])].join(':'))
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function eventFromTransactionRow(row: AppendTransactionRow): ConversationEventRow {
  const sequence = Number(row.sequence)
  if (!row.id || !row.tenant_id || !row.conversation_id || !row.actor_id || !row.idempotency_key || !row.kind) {
    throw new Error(`appendConversationEvent: ${row.outcome} result omitted event identity`)
  }
  if (!Number.isSafeInteger(sequence)) throw new Error('appendConversationEvent: invalid sequence')
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    conversation_id: row.conversation_id,
    actor_id: row.actor_id,
    sequence,
    idempotency_key: row.idempotency_key,
    kind: row.kind,
    payload: row.payload ?? {},
    reply_to_event_id: row.reply_to_event_id ?? null,
    target_event_id: row.target_event_id ?? null,
    references: row.references ?? [],
    created_at: row.created_at ?? '',
  }
}

function isSameSemanticEvent(event: ConversationEventRow, input: AppendConversationEventInput): boolean {
  return event.actor_id === input.actorId
    && event.kind === input.kind
    && event.reply_to_event_id === (input.replyToEventId ?? null)
    && event.target_event_id === (input.targetEventId ?? null)
    && canonicalJson(event.payload) === canonicalJson(input.payload ?? {})
    && canonicalJson(event.references) === canonicalJson(input.references ?? [])
}

export async function appendConversationEvent(
  sql: Sql,
  input: AppendConversationEventInput,
): Promise<AppendConversationEventResult> {
  const client = sql as unknown as {
    query: (query: string, params: unknown[]) => unknown
    transaction: (
      queries: unknown[],
      options: { isolationLevel: 'ReadCommitted' },
    ) => Promise<unknown[][]>
  }
  const lockQuery = client.query(
    `select c.id
     from "conversations" c
     where c.tenant_id = $1 and c.id = $2
     for update`,
    [input.tenantId, input.conversationId],
  )
  const appendQuery = client.query(
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
       select e.*
       from "conversation_events" e
       where e.tenant_id = $1 and e.conversation_id = $2 and e.idempotency_key = $4
       limit 1
     ), valid_links as materialized (
       select
         (
           ($7::uuid is null)
           or (
             $5::text = 'message.created'
             and exists (
               select 1 from "conversation_events" r
               where r.tenant_id = $1 and r.conversation_id = $2 and r.id = $7::uuid
                 and r.kind in ('message.created', 'message.edited')
                 and not exists (
                   select 1 from "conversation_events" rd
                   where rd.tenant_id = r.tenant_id and rd.conversation_id = r.conversation_id
                     and rd.target_event_id = r.id and rd.kind = 'message.deleted'
                 )
             )
           )
         )
         and (
           case when $5::text in ('message.edited', 'message.deleted') then
             $8::uuid is not null
             and exists (
               select 1 from "conversation_events" t
               where t.tenant_id = $1 and t.conversation_id = $2 and t.id = $8::uuid
                 and t.kind in ('message.created', 'message.edited')
                 and not exists (
                   select 1 from "conversation_events" later
                   where later.tenant_id = t.tenant_id and later.conversation_id = t.conversation_id
                     and later.target_event_id = t.id
                     and later.kind in ('message.edited', 'message.deleted')
                 )
             )
           else $8::uuid is null end
         ) as links_valid
     ), allocated as materialized (
       update "conversations" c
       set next_sequence = c.next_sequence + 1, updated_at = now()
       from authorization a, valid_links v
       where c.tenant_id = $1 and c.id = $2 and c.status = 'active'
         and case
           when $5::text in ('membership.added', 'membership.changed', 'membership.removed') then a.role = 'admin'
           else a.role in ('writer', 'admin')
         end
         and v.links_valid
         and not exists (select 1 from existing)
       returning c.next_sequence - 1 as sequence
     ), inserted as materialized (
       insert into "conversation_events" (
         id, tenant_id, conversation_id, actor_id, sequence, idempotency_key,
         kind, payload, reply_to_event_id, target_event_id, references
       )
       select gen_random_uuid(), $1, $2::uuid, $3::uuid, allocated.sequence, $4,
         $5::conversation_event_kind, $6::jsonb, $7::uuid, $8::uuid, $9::jsonb
       from allocated
       returning *
     )
     select
       case
         when a.actor_id is null then 'not_found'
         when not case
           when $5::text in ('membership.added', 'membership.changed', 'membership.removed') then a.role = 'admin'
           else a.role in ('writer', 'admin')
         end then 'forbidden'
         when a.conversation_status = 'archived' then 'archived'
         when e.id is not null then 'existing'
         when not v.links_valid then 'invalid_reference'
         when i.id is not null then 'inserted'
         else 'failed'
       end as outcome,
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
     from valid_links v
     left join authorization a on true
     left join existing e on true
     left join inserted i on true`,
    [
      input.tenantId,
      input.conversationId,
      input.actorId,
      input.idempotencyKey,
      input.kind,
      JSON.stringify(input.payload ?? {}),
      input.replyToEventId ?? null,
      input.targetEventId ?? null,
      JSON.stringify(input.references ?? []),
    ],
  )
  const results = await client.transaction([lockQuery, appendQuery], { isolationLevel: 'ReadCommitted' })
  const row = results[1]?.[0] as AppendTransactionRow | undefined
  if (!row || row.outcome === 'failed') throw new Error('appendConversationEvent: transaction returned no outcome')
  if (row.outcome === 'inserted') return { ok: true, duplicate: false, event: eventFromTransactionRow(row) }
  if (row.outcome === 'existing') {
    const event = eventFromTransactionRow(row)
    return isSameSemanticEvent(event, input)
      ? { ok: true, duplicate: true, event }
      : { ok: false, reason: 'idempotency_conflict' }
  }
  return { ok: false, reason: row.outcome }
}

export async function listConversationEvents(
  sql: Sql,
  input: {
    tenantId: string
    conversationId: string
    actorId: string
    afterSequence: number
    limit?: number
  },
): Promise<{ ok: true; events: ConversationEventRow[] } | ConversationAuthorizationFailure> {
  const authorization = await authorizeConversation(
    sql,
    { tenantId: input.tenantId, conversationId: input.conversationId, actorId: input.actorId },
    ['reader', 'writer', 'admin'],
  )
  if (!authorization.ok) return authorization
  const rows = await runQuery<ConversationEventRow>(
    sql,
    `select id, tenant_id, conversation_id, actor_id, sequence, idempotency_key,
       kind, payload, reply_to_event_id, target_event_id, references, created_at
     from "conversation_events"
     where tenant_id = $1 and conversation_id = $2 and sequence > $3
     order by sequence asc
     limit $4`,
    [input.tenantId, input.conversationId, input.afterSequence, input.limit ?? 100],
  )
  return {
    ok: true,
    events: rows.map((row) => {
      const sequence = Number(row.sequence)
      if (!Number.isSafeInteger(sequence)) throw new Error('listConversationEvents: invalid sequence')
      return { ...row, sequence }
    }),
  }
}
