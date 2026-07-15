import type { Sql } from '@product-suite/db'

import type { UIMessage } from 'ai'

/**
 * A durable chat thread (see docs/design/2026-07-15-thread-persistence.md). The
 * thread GROUPS the runs that produced it; its message history is DERIVED by
 * concatenating those runs' UIMessage deltas — the thread owns no transcript of its
 * own (no second write path). Every function here is tenant-scoped: a foreign/unknown
 * id is simply invisible, so a caller can only ever see or act on their own org's
 * threads.
 */

/** The panel's "Linked to" object — the screen/work item the thread was opened on. */
export interface ThreadLinkedObject {
  type: string
  id: string
  title: string
}

/** A thread row as the panel list needs it (snake_case DB columns). */
export interface ThreadListRow {
  id: string
  title: string
  linked_object: ThreadLinkedObject | null
  updated_at: string | Date
}

/** A thread row scoped to a caller (used for ownership checks). */
export interface ThreadRow {
  id: string
  tenant_id: string
  title: string
  linked_object: ThreadLinkedObject | null
  archived: boolean
  created_at: string | Date
  updated_at: string | Date
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/**
 * Derive a thread title from the FIRST user message — its first ~60 chars, trimmed.
 * Deliberately NOT an LLM call (over-built): a cheap, deterministic label the user
 * can always recognize. Empty when there is no user text (the row keeps its '').
 */
export function titleFromFirstMessage(messages: UIMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  const text = (firstUser?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim()
  return text.slice(0, 60)
}

/**
 * Concatenate a thread's run transcripts into the full `UIMessage[]` history. Only
 * contract-v1 rows contribute; any `version !== 1` (the legacy ModelMessage/assistant-
 * only shape, or a null transcript) is SKIPPED — those predate threads and belong to
 * none. Rows must be passed in `created_at` order so the reconstruction is in order.
 */
export function concatDeltas(transcripts: unknown[]): UIMessage[] {
  const out: UIMessage[] = []
  const seen = new Set<string>()
  for (const t of transcripts) {
    if (!t || typeof t !== 'object') continue
    const rec = t as { version?: unknown; messages?: unknown }
    if (rec.version !== 1) continue
    if (!Array.isArray(rec.messages)) continue
    for (const m of rec.messages as UIMessage[]) {
      // Dedup by message id: a mid-stream network drop can complete the run
      // server-side while the client's Retry (`regenerate`) resends the SAME user
      // message (same id) into a second run. Without this the reconstruction shows
      // that turn twice — and React sees duplicate keys.
      const id = (m as { id?: unknown }).id
      if (typeof id === 'string') {
        if (seen.has(id)) continue
        seen.add(id)
      }
      out.push(m)
    }
  }
  return out
}

/**
 * Create a thread anchored to ONE org and return its id. The SERVER owns creation
 * (kills the first-message race: never client-create-then-save). Title is derived,
 * `linked_object` is the panel's scoping object (or null).
 */
export async function createThread(
  sql: Sql,
  input: { tenantId: string; title: string; linkedObject?: ThreadLinkedObject | null },
): Promise<string> {
  const rows = await runQuery<{ id: string }>(
    sql,
    `insert into "chat_threads" ("tenant_id", "title", "linked_object")
     values ($1, $2, $3::jsonb) returning id`,
    [input.tenantId, input.title, input.linkedObject ? JSON.stringify(input.linkedObject) : null],
  )
  const id = rows[0]?.id
  if (!id) throw new Error('createThread: insert returned no id')
  return id
}

/**
 * Fetch one thread scoped to the caller's tenants — `null` when it is not theirs (a
 * foreign/unknown id). The single ownership gate every thread route funnels through.
 */
export async function getThreadScoped(
  sql: Sql,
  id: string,
  tenantIds: string[],
): Promise<ThreadRow | null> {
  const rows = await runQuery<ThreadRow>(
    sql,
    `select id, tenant_id, title, linked_object, archived, created_at, updated_at
     from "chat_threads" where id = $1 and tenant_id = any($2) limit 1`,
    [id, tenantIds],
  )
  return rows[0] ?? null
}

/** Max threads returned to the panel list — bounds the payload as threads accumulate. */
export const THREAD_LIST_LIMIT = 50

/** The org's non-archived threads, newest first — exactly what the panel list renders. */
export async function listThreads(sql: Sql, tenantId: string): Promise<ThreadListRow[]> {
  return runQuery<ThreadListRow>(
    sql,
    `select id, title, linked_object, updated_at from "chat_threads"
     where tenant_id = $1 and archived = false
     order by updated_at desc limit ${THREAD_LIST_LIMIT}`,
    [tenantId],
  )
}

/**
 * Bump a thread's `updated_at` so the panel list (ordered by `updated_at desc`)
 * surfaces recently-active threads first. Called when a run in the thread completes
 * — otherwise the list is stuck in creation order. Tenant-scoped; a foreign id is a
 * silent no-op (never touches another org's row).
 */
export async function touchThread(sql: Sql, threadId: string, tenantId: string): Promise<void> {
  await runQuery(
    sql,
    `update "chat_threads" set updated_at = now() where id = $1 and tenant_id = $2`,
    [threadId, tenantId],
  )
}

/**
 * Soft-delete a thread (set `archived`). Scoped to the caller's tenants; returns
 * false when the id is not theirs (⇒ the route answers 404, never a leak).
 */
export async function archiveThread(sql: Sql, id: string, tenantIds: string[]): Promise<boolean> {
  const rows = await runQuery<{ id: string }>(
    sql,
    `update "chat_threads" set archived = true, updated_at = now()
     where id = $1 and tenant_id = any($2) returning id`,
    [id, tenantIds],
  )
  return rows.length > 0
}

/**
 * Reconstruct a thread's full `UIMessage[]` history: its COMPLETED runs' deltas,
 * concatenated in `created_at` order (contract v1; v0/legacy rows skipped). Scoped to
 * the thread's own tenant, so nothing crosses orgs.
 */
export async function reconstructThreadMessages(
  sql: Sql,
  threadId: string,
  tenantId: string,
): Promise<UIMessage[]> {
  const rows = await runQuery<{ transcript: unknown }>(
    sql,
    `select transcript from "agent_runs"
     where thread_id = $1 and tenant_id = $2 and status = 'completed'
     order by created_at`,
    [threadId, tenantId],
  )
  return concatDeltas(rows.map((r) => r.transcript))
}
