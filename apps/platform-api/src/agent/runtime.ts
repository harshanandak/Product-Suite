import { convertToModelMessages, stepCountIs, streamText, type LanguageModel, type UIMessage } from 'ai'

import type { Sql } from '@product-suite/db'

import { buildTools } from './tools'

/**
 * The agent's operating instructions. It is a workboard copilot that READS via the
 * retrieval tools and PROPOSES changes — it never claims to have changed anything,
 * because every mutation goes through the human-reviewed proposals queue.
 */
export const AGENT_SYSTEM_PROMPT = [
  'You are the Product-Suite workboard copilot.',
  'You help the user understand and improve their work items.',
  'To change anything, you MUST use the propose_* tools — they queue a proposal a human reviews and accepts. You never modify data directly, so never claim you did.',
  'After using a propose_* tool, say "I\'ve proposed …, pending your review" — never "I\'ve updated", "I\'ve created", or "I\'ve changed", because nothing takes effect until a human accepts the proposal.',
  'Prefer searching/listing before proposing, and give a short rationale with every proposal.',
].join(' ')

/**
 * The object the current chat thread is scoped to (the screen the user was on
 * when they opened the panel), plus its workspace. Sent as hidden request
 * context and folded into the system prompt — never injected as a fake user
 * message (which would pollute the transcript and let the agent quote it back).
 */
export interface AgentScope {
  workspace: string
  object?: { type: string; id: string; title: string }
}

/**
 * Build the run's system prompt: the static base, plus a single context line
 * naming the object the user is viewing when one is in scope. Absent an object,
 * the base prompt is returned verbatim (a bare workspace adds nothing useful).
 */
export function buildSystemPrompt(scope?: AgentScope): string {
  const object = scope?.object
  if (!object) return AGENT_SYSTEM_PROMPT
  const context = `The user is currently viewing ${object.type} "${object.title}" (id ${object.id}) in workspace ${scope.workspace}.`
  return `${AGENT_SYSTEM_PROMPT} ${context}`
}

/** The authority + model the run executes under. Request-free by design. */
export interface AgentRunContext {
  /**
   * The single org the whole run — reads, retrieval, AND proposals — is anchored
   * to. One consistent org per run, so nothing crosses tenants.
   */
  tenantId: string
  /** The human (users.id) the agent acts on behalf of. */
  userId: string
  /** The resolved language model (from `agentModel(env)`). */
  model: LanguageModel
  /**
   * Optional object-scoping for the run: the screen/work item the user was
   * viewing when they opened the chat. Folded into the system prompt so the
   * agent knows the context without it polluting the message transcript.
   */
  scope?: AgentScope
  /**
   * Optional Workers `executionCtx.waitUntil`, threaded from the Hono context when
   * reachable. Keeps the worker alive until the stream is fully consumed and the
   * run is closed, even after the client aborts / the Response has returned.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

/** Resolve the model id string for provenance (LanguageModel may be a bare id). */
function resolveModelId(model: LanguageModel): string | null {
  if (typeof model === 'string') return model
  const id = (model as { modelId?: unknown }).modelId
  return typeof id === 'string' ? id : null
}

/** Coerce any thrown value to a short message string. */
function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/** Mint the run row (status='running') and return its id — the provenance anchor. */
async function mintRun(sql: Sql, tenantId: string, userId: string): Promise<string> {
  const rows = await runQuery<{ id: string }>(
    sql,
    `insert into "agent_runs" ("tenant_id", "triggered_by", "kind", "status")
     values ($1, $2, 'chat', 'running') returning id`,
    [tenantId, userId],
  )
  const id = rows[0]?.id
  if (!id) throw new Error('mintRun: insert returned no id')
  return id
}

/**
 * Close a run: persist the transcript + final status + a short summary. The
 * `status = 'running'` guard makes this a one-way latch — once `onError` flips the
 * run to `failed`, a later `onFinish` cannot overwrite it back to `completed`.
 */
async function closeRun(
  sql: Sql,
  runId: string,
  status: 'completed' | 'failed',
  summary: string,
  transcript: unknown,
): Promise<void> {
  await runQuery(
    sql,
    `update "agent_runs"
     set status = $1, summary = $2, transcript = $3::jsonb, updated_at = now()
     where id = $4 and status = 'running'`,
    [status, summary.slice(0, 500), JSON.stringify(transcript ?? null), runId],
  )
}

/**
 * Close a run without ever throwing. `onFinish`/`onError` run detached from the
 * request, so a DB error here must be swallowed (logged) rather than surface as an
 * unhandled rejection that could crash the isolate.
 */
async function safeCloseRun(
  sql: Sql,
  runId: string,
  status: 'completed' | 'failed',
  summary: string,
  transcript: unknown,
): Promise<void> {
  try {
    await closeRun(sql, runId, status, summary, transcript)
  } catch (cause) {
    console.error('[agent-runtime] closeRun failed', { runId, status, cause })
  }
}

/**
 * The request-free agent loop (design §3): a pure function of `(sql, ctx, messages)`
 * with NO Request/Response threaded in, so a future queue consumer can drive an
 * autonomous run through the exact same path. It mints an `agent_runs` row, runs
 * the Vercel AI SDK `streamText` loop with the tenant-bound ToolRegistry, persists
 * the transcript + closes the run on finish, and returns the UI message stream.
 */
export async function runAgentChat(
  sql: Sql,
  ctx: AgentRunContext,
  messages: UIMessage[],
): Promise<Response> {
  const runId = await mintRun(sql, ctx.tenantId, ctx.userId)
  const modelId = resolveModelId(ctx.model)
  const tools = buildTools(sql, { tenantId: ctx.tenantId, userId: ctx.userId, runId, modelId })

  let result: ReturnType<typeof streamText>
  try {
    // v6 `convertToModelMessages` is async and THROWS on malformed `parts`. It must
    // run inside this guard so a bogus message flips the (already-minted) run to
    // `failed` instead of stranding it `running` forever.
    const modelMessages = await convertToModelMessages(messages)
    result = streamText({
      model: ctx.model,
      system: buildSystemPrompt(ctx.scope),
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(8),
      onFinish: async ({ text, response, steps }) => {
        // The decision corpus: the response messages (assistant + tool calls/results)
        // plus the step count, captured once the loop settles (design §13). Guarded
        // by `status = 'running'`, so it never overwrites an `onError` failure.
        const transcript = { messages: response.messages, steps: steps.length }
        await safeCloseRun(sql, runId, 'completed', text, transcript)
      },
      onError: async ({ error }) => {
        await safeCloseRun(sql, runId, 'failed', errMessage(error), null)
      },
    })
  } catch (cause) {
    // Any throw before the stream exists (e.g. malformed messages) must still close
    // the run — no path may leave it `running`.
    await safeCloseRun(sql, runId, 'failed', errMessage(cause), null)
    throw cause
  }

  // Abort-safety (AI SDK v6): `consumeStream()` drives the stream to completion
  // server-side so `onFinish`/`onError` always run — even if the client aborts and
  // never reads the body. `waitUntil` (when on Workers) keeps the isolate alive
  // until the run is closed. Errors are already handled via `onError`, so swallow.
  const settled = Promise.resolve(result.consumeStream({ onError: () => {} })).catch(() => {})
  if (ctx.waitUntil) ctx.waitUntil(settled)

  return result.toUIMessageStreamResponse()
}
