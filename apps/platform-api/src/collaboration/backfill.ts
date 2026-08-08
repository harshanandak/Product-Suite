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

export interface CollaborationBackfillReport {
  applied: boolean
  threads: number
  events: number
  unresolvedUsers: string[]
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[] = []): Promise<Row[]> {
  return (sql as unknown as { query: (query: string, params: unknown[]) => Promise<Row[]> }).query(text, params)
}

export function legacyEventsForRun(runId: string, transcript: unknown, startSequence: number): LegacyBackfillEvent[] {
  if (!transcript || typeof transcript !== 'object') return []
  const record = transcript as { version?: unknown; messages?: unknown }
  if (record.version !== 1 || !Array.isArray(record.messages)) return []
  return record.messages.map((message, index) => {
    const messageId = typeof (message as { id?: unknown })?.id === 'string'
      ? (message as { id: string }).id
      : String(index)
    return {
      sequence: startSequence + index,
      idempotencyKey: `legacy:agent_run:${runId}:message:${messageId}`,
      runId,
      userId: null,
      message,
      references: [{ kind: 'agent_run', id: runId }],
    }
  })
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
  await runQuery(
    sql,
    `with service_actor as materialized (
       insert into "collaboration_actors" (tenant_id, kind, owning_domain, owning_id)
       values ($1, 'service', 'platform.migration', 'chat_threads')
       on conflict (tenant_id, owning_domain, owning_id) do update
       set updated_at = "collaboration_actors".updated_at
       returning id, disabled_at
     ), user_rows as materialized (
       select user_id from jsonb_to_recordset($5::jsonb) as users(user_id text)
     ), human_actors as materialized (
       insert into "collaboration_actors" (tenant_id, kind, owning_domain, owning_id)
       select $1, 'human', 'identity.user', user_id from user_rows
       on conflict (tenant_id, owning_domain, owning_id) do nothing
       returning id
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
       from conversation_write, service_actor, user_rows
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
}

export async function runCollaborationBackfill(
  sql: Sql,
  options: { apply: boolean },
): Promise<CollaborationBackfillReport> {
  const threads = await runQuery<SourceThread>(
    sql,
    `select id, tenant_id, title, archived, linked_object
     from "chat_threads" order by tenant_id, created_at, id`,
  )
  let eventCount = 0
  const unresolved = new Set<string>()
  for (const thread of threads) {
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
    eventCount += events.length
    if (options.apply) await applyThread(sql, thread, runs, events)
  }
  return {
    applied: options.apply,
    threads: threads.length,
    events: eventCount,
    unresolvedUsers: [...unresolved].sort((left, right) => left.localeCompare(right)),
  }
}
