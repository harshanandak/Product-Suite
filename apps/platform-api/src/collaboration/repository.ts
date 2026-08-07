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
  return actor && actor.disabled_at === null ? actor : null
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