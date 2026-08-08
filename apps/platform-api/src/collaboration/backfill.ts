import type { Sql } from '@product-suite/db'

export interface LegacyBackfillEvent {
  sequence: number
  idempotencyKey: string
  runId: string
  userId: string | null
  message: unknown
  references: [{ kind: 'agent_run'; id: string }]
}

interface SourceThread {
  id: string
  tenant_id: string
  created_at: string
  title: string
  archived?: boolean
  linked_object?: unknown
}

interface SourceRun {
  id: string
  triggered_by: string | null
  resolved_user_id: string | null
  transcript: unknown
}

export interface CollaborationBackfillCursor {
  tenantId: string
  createdAt: string
  id: string
}

export interface CollaborationBackfillReport {
  applied: boolean
  threads: number
  events: number
  unresolvedUsers: string[]
  lastSuccessfulCursor: CollaborationBackfillCursor | null
}

interface CollaborationBackfillOptions {
  apply: boolean
  cursor?: CollaborationBackfillCursor | null
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 1000

function runQuery<Row>(sql: Sql, text: string, params: unknown[] = []): Promise<Row[]> {
  return (sql as unknown as { query: (query: string, params: unknown[]) => Promise<Row[]> }).query(text, params)
}

export function legacyEventsForRun(runId: string, transcript: unknown, startSequence: number): LegacyBackfillEvent[] {
  if (!transcript || typeof transcript !== 'object') return []
  const record = transcript as { version?: unknown; messages?: unknown }
  if (record.version !== 1 || !Array.isArray(record.messages)) return []
  return record.messages.map((message, index) => {
    const messageKey = typeof (message as { id?: unknown })?.id === 'string'
      ? `id:${(message as { id: string }).id}`
      : `index:${index}`
    return {
      sequence: startSequence + index,
      idempotencyKey: `legacy:agent_run:${runId}:message:${messageKey}`,
      runId,
      userId: null,
      message,
      references: [{ kind: 'agent_run', id: runId }],
    }
  })
}

async function provisionActors(sql: Sql, tenantId: string, resolvedUsers: string[]) {
  const serviceActors = await runQuery<{ id: string; disabled_at: unknown }>(
    sql,
    `with service_actor as materialized (
       insert into "collaboration_actors" (tenant_id, kind, owning_domain, owning_id)
       values ($1, 'service', 'platform.migration', 'chat_threads')
       on conflict (tenant_id, owning_domain, owning_id) do update
       set updated_at = "collaboration_actors".updated_at
       returning id, disabled_at
     ), user_rows as materialized (
       select user_id from jsonb_to_recordset($2::jsonb) as users(user_id text)
     ), human_actors as materialized (
       insert into "collaboration_actors" (tenant_id, kind, owning_domain, owning_id)
       select $1, 'human', 'identity.user', user_id from user_rows
       on conflict (tenant_id, owning_domain, owning_id) do nothing
       returning id
     )
     select service_actor.id, service_actor.disabled_at,
       (select count(*) from human_actors) as provisioned_human_actors
     from service_actor`,
    [tenantId, JSON.stringify(resolvedUsers.map((user_id) => ({ user_id })))],
  )
  const serviceActor = serviceActors[0]
  if (serviceActor?.disabled_at !== null) {
    throw new Error(`Collaboration backfill service actor is disabled for tenant ${tenantId}`)
  }
}

async function applyThread(sql: Sql, thread: SourceThread, runs: SourceRun[], events: LegacyBackfillEvent[]) {
  const resolvedUsers = [...new Set(runs.map((run) => run.resolved_user_id).filter((id): id is string => Boolean(id)))]
  const eventRows = events.map((event) => ({
    sequence: event.sequence,
    idempotency_key: event.idempotencyKey,
    run_id: event.runId,
    user_id: event.userId,
    message: event.message,
    references: event.references,
  }))
  await provisionActors(sql, thread.tenant_id, resolvedUsers)
  const conversations = await runQuery<{ id: string }>(
    sql,
    `with service_actor as materialized (
       select id, disabled_at from "collaboration_actors"
       where tenant_id = $1 and kind = 'service'
         and owning_domain = 'platform.migration' and owning_id = 'chat_threads'
     ), user_rows as materialized (
       select user_id from jsonb_to_recordset($5::jsonb) as users(user_id text)
     ), conversation_write as materialized (
       insert into "conversations" (
         id, tenant_id, title, status, subject_ref, created_by_actor_id, legacy_source, legacy_id
       )
       select $2::uuid, $1, $3, case when $4 then 'archived' else 'active' end::conversation_status,
         $6::jsonb, service_actor.id, 'platform.chat_threads', $2
       from service_actor where service_actor.disabled_at is null
       on conflict (tenant_id, legacy_source, legacy_id) do update
       set legacy_id = excluded.legacy_id
       returning id
     ), membership_write as materialized (
       insert into "conversation_memberships" (
         tenant_id, conversation_id, actor_id, role, status, created_by_actor_id
       )
       select $1, conversation_write.id, actor.id, 'admin', 'active', service_actor.id
       from conversation_write
       cross join service_actor
       cross join user_rows
       join "collaboration_actors" actor
         on actor.tenant_id = $1 and actor.kind = 'human'
        and actor.owning_domain = 'identity.user' and actor.owning_id = user_rows.user_id
        and actor.disabled_at is null
       on conflict (tenant_id, conversation_id, actor_id) do nothing
       returning id
     ), event_rows as materialized (
       select * from jsonb_to_recordset($7::jsonb) as source(
         sequence bigint, idempotency_key text, run_id text, user_id text, message jsonb, "references" jsonb
       )
     ), event_write as materialized (
       insert into "conversation_events" (
         id, tenant_id, conversation_id, actor_id, sequence, idempotency_key, kind, payload, "references"
       )
       select (
         substr(md5(event_rows.idempotency_key), 1, 8) || '-' ||
         substr(md5(event_rows.idempotency_key), 9, 4) || '-' ||
         substr(md5(event_rows.idempotency_key), 13, 4) || '-' ||
         substr(md5(event_rows.idempotency_key), 17, 4) || '-' ||
         substr(md5(event_rows.idempotency_key), 21, 12)
       )::uuid, $1, conversation_write.id, coalesce(actor.id, service_actor.id), event_rows.sequence,
         event_rows.idempotency_key, 'message.created', jsonb_build_object('message', event_rows.message),
         event_rows."references"
       from event_rows
       cross join conversation_write
       cross join service_actor
       left join "collaboration_actors" actor
         on actor.tenant_id = $1 and actor.kind = 'human'
        and actor.owning_domain = 'identity.user' and actor.owning_id = event_rows.user_id
        and actor.disabled_at is null
       on conflict (tenant_id, conversation_id, idempotency_key) do nothing
       returning id
     ), sequence_advance as materialized (
       update "conversations" c
       set next_sequence = greatest(c.next_sequence, $8::bigint), updated_at = now()
       from conversation_write where c.tenant_id = $1 and c.id = conversation_write.id
       returning c.id
     ), run_links as materialized (
       update "agent_runs" r set conversation_id = conversation_write.id, updated_at = now()
       from conversation_write where r.tenant_id = $1 and r.thread_id = $2::uuid
       returning r.id
     )
     select id from conversation_write`,
    [
      thread.tenant_id,
      thread.id,
      thread.title,
      thread.archived ?? false,
      JSON.stringify(resolvedUsers.map((user_id) => ({ user_id }))),
      JSON.stringify(thread.linked_object ?? null),
      JSON.stringify(eventRows),
      events.length + 1,
    ],
  )
  if (conversations.length === 0) {
    throw new Error(`Collaboration backfill could not write conversation ${thread.id}`)
  }
}

async function loadThreadEvents(sql: Sql, thread: SourceThread, unresolved: Set<string>) {
  const runs = await runQuery<SourceRun>(
    sql,
    `select r.id, r.triggered_by, u.id as resolved_user_id, r.transcript
     from "agent_runs" r
     left join "users" u on u.id = r.triggered_by
     where r.tenant_id = $1 and r.thread_id = $2
     order by r.created_at, r.id`,
    [thread.tenant_id, thread.id],
  )
  const events: LegacyBackfillEvent[] = []
  for (const run of runs) {
    if (run.triggered_by && !run.resolved_user_id) unresolved.add(run.triggered_by)
    const runEvents = legacyEventsForRun(run.id, run.transcript, events.length + 1)
    events.push(...runEvents.map((event) => ({ ...event, userId: run.resolved_user_id })))
  }
  return { runs, events }
}

export async function runCollaborationBackfill(
  sql: Sql,
  options: CollaborationBackfillOptions,
): Promise<CollaborationBackfillReport> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`Collaboration backfill pageSize must be between 1 and ${MAX_PAGE_SIZE}`)
  }
  let eventCount = 0
  let threadCount = 0
  let lastSuccessfulCursor = options.cursor ?? null
  const unresolved = new Set<string>()
  while (true) {
    const threads = await runQuery<SourceThread>(
      sql,
      `select id, tenant_id, created_at::text as created_at, title, archived, linked_object
       from "chat_threads"
       where ($1::text is null or (tenant_id, created_at, id) > ($1::text, $2::timestamptz, $3::uuid))
       order by tenant_id, created_at, id
       limit $4`,
      [
        lastSuccessfulCursor?.tenantId ?? null,
        lastSuccessfulCursor?.createdAt ?? null,
        lastSuccessfulCursor?.id ?? null,
        pageSize,
      ],
    )
    for (const thread of threads) {
      const { runs, events } = await loadThreadEvents(sql, thread, unresolved)
      eventCount += events.length
      if (options.apply) await applyThread(sql, thread, runs, events)
      threadCount += 1
      lastSuccessfulCursor = {
        tenantId: thread.tenant_id,
        createdAt: thread.created_at,
        id: thread.id,
      }
    }
    if (threads.length < pageSize) break
  }
  return {
    applied: options.apply,
    threads: threadCount,
    events: eventCount,
    unresolvedUsers: [...unresolved].sort((left, right) => left.localeCompare(right)),
    lastSuccessfulCursor,
  }
}
