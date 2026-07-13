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
  'Prefer searching/listing before proposing, and give a short rationale with every proposal.',
].join(' ')

/** The authority + model the run executes under. Request-free by design. */
export interface AgentRunContext {
  /** Orgs the caller may read across (reads are scoped to these). */
  tenantIds: string[]
  /** The single org the run + its proposals are anchored to. */
  tenantId: string
  /** The human (users.id) the agent acts on behalf of. */
  userId: string
  /** The resolved language model (from `agentModel(env)`). */
  model: LanguageModel
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

/** Close a run: persist the transcript + final status + a short summary. */
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
     where id = $4`,
    [status, summary.slice(0, 500), JSON.stringify(transcript ?? null), runId],
  )
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
  const tools = buildTools(sql, { tenantIds: ctx.tenantIds, userId: ctx.userId, runId })

  const result = streamText({
    model: ctx.model,
    system: AGENT_SYSTEM_PROMPT,
    // v6 `convertToModelMessages` is async (it may resolve file/data parts).
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
    onFinish: async ({ text, response, steps }) => {
      // The decision corpus: the response messages (assistant + tool calls/results)
      // plus the step count, captured once the loop settles (design §13).
      const transcript = { messages: response.messages, steps: steps.length }
      await closeRun(sql, runId, 'completed', text, transcript)
    },
    onError: async ({ error }) => {
      const message = error instanceof Error ? error.message : String(error)
      await closeRun(sql, runId, 'failed', message, null)
    },
  })

  return result.toUIMessageStreamResponse()
}
