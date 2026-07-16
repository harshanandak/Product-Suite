import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type { Sql } from '@product-suite/db'

import { getMemoryScoped, isIsoDateString } from '../domain/memories'
import { createProposal } from '../proposals/repository'
import { insertAttributions, resolveChain, searchMemories } from './memory-retrieval'
import { retrieve, type ItemHit } from './retrieve'

/** The prompt template version stamped on every proposal for the decision corpus. */
export const PROMPT_VERSION = 'agent-v1'

/**
 * The authority the tools act under. The agent has NO identity of its own — it
 * acts as the chatting human (`userId`) within a specific run (`runId`), anchored
 * to ONE org (`tenantId`). The whole run — reads, retrieval, AND proposals — is
 * scoped to that single `tenantId`, so a proposal can never be stamped org-A while
 * targeting an org-B row. Every proposal is stamped with `runId` +
 * `on_behalf_of=userId` + provenance (`modelId`, `PROMPT_VERSION`).
 */
export interface ToolContext {
  /** The single org the whole run (reads + proposals) is anchored to. */
  tenantId: string
  userId: string
  runId: string
  /** The resolved model id string, stamped on proposals for the decision corpus. */
  modelId: string | null
  /** True on a holdout run: `search_memory` must NOT be exposed — a holdout run gets NO memory, via fence or tool. */
  holdout?: boolean
}

/** Outcome of a `propose_*` tool: a queued proposal id, or a refusal reason. */
type ProposeResult = { proposed: true; proposal_id: string } | { proposed: false; error: string }

/** The input schema for `propose_memory`, hoisted so the payload builders can share its type. */
const proposeMemorySchema = z.object({
  operation: z.enum(['create', 'supersede', 'retract', 'defer']),
  // create
  kind: z.enum(['decision', 'fact', 'rule']).optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  topics: z.array(z.string()).optional(),
  scope_type: z.enum(['org', 'project', 'work_item_type', 'work_item']).optional(),
  scope_id: z.string().optional(),
  // supersede / retract / defer
  target_id: z.string().optional(),
  change_reason: z.string().optional(),
  waiting_on: z.string().optional(),
  review_after: z.string().optional(),
  rationale: z.string().optional(),
})
type ProposeMemoryArgs = z.infer<typeof proposeMemorySchema>

/** A validated proposal payload + its target, or a refusal — the output of a memory builder. */
type MemoryBuild = { error: string } | { payload: Record<string, unknown>; targetId: string | null }

/** create → NEW memory. Requires kind + a non-empty title; forwards only set optionals. */
function buildCreateMemory(args: ProposeMemoryArgs): MemoryBuild {
  const title = (args.title ?? '').trim()
  if (!args.kind) return { error: 'kind is required to log a memory' }
  if (!title) return { error: 'title is required to log a memory' }
  const payload: Record<string, unknown> = { kind: args.kind, title }
  if (args.body !== undefined) payload.body = args.body
  if (args.topics !== undefined) payload.topics = args.topics
  if (args.scope_type !== undefined) payload.scope_type = args.scope_type
  if (args.scope_id !== undefined) payload.scope_id = args.scope_id
  return { payload, targetId: null }
}

/**
 * supersede → replace a memory with a new version. Needs a change_reason. Trims and
 * forwards only NON-EMPTY title/body overrides: an empty one must omit the key (send
 * `undefined`) so the domain's coalesce keeps the old value — never `''`, which would
 * silently blank the field and show a "0 changes" diff.
 */
function buildSupersedeMemory(args: ProposeMemoryArgs, targetId: string): MemoryBuild {
  const changeReason = (args.change_reason ?? '').trim()
  if (!changeReason) return { error: 'change_reason is required to supersede a memory' }
  const payload: Record<string, unknown> = { change_reason: changeReason }
  const title = (args.title ?? '').trim()
  if (title) payload.title = title
  const body = (args.body ?? '').trim()
  if (body) payload.body = body
  if (args.topics !== undefined) payload.topics = args.topics
  return { payload, targetId }
}

/**
 * defer → park a memory. Validates `review_after` HERE so a free-form value
 * ("next quarter") is a refusal, never a queued proposal that cast-errors (500 + wedge)
 * on accept.
 */
function buildDeferMemory(args: ProposeMemoryArgs, targetId: string): MemoryBuild {
  const payload: Record<string, unknown> = {}
  if (args.waiting_on !== undefined) payload.waiting_on = args.waiting_on
  if (args.review_after !== undefined) {
    const reviewAfter = args.review_after.trim()
    if (reviewAfter && !isIsoDateString(reviewAfter)) {
      return { error: 'review_after must be an ISO date (e.g. 2026-08-01)' }
    }
    if (reviewAfter) payload.review_after = reviewAfter
  }
  return { payload, targetId }
}

/**
 * Dispatch a `propose_memory` call to the right per-operation builder. Keeps the tool's
 * `execute` a thin dispatch (create has no target; supersede/retract/defer each name one).
 */
function buildMemoryPayload(args: ProposeMemoryArgs): MemoryBuild {
  if (args.operation === 'create') return buildCreateMemory(args)
  const targetId = (args.target_id ?? '').trim()
  if (!targetId) return { error: `target_id is required to ${args.operation} a memory` }
  if (args.operation === 'supersede') return buildSupersedeMemory(args, targetId)
  if (args.operation === 'defer') return buildDeferMemory(args, targetId)
  return { payload: {}, targetId } // retract carries no payload beyond its target
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

/** Re-project any work_items row to the compact hit shape — nothing else escapes. */
function toHit(r: ItemHit): ItemHit {
  return { id: r.id, title: r.title, status_id: r.status_id, priority: r.priority, team_id: r.team_id }
}

/**
 * Build the agent's 5 retrieval-first tools (the ToolRegistry). Every execute runs
 * server-side and is bound to `ctx` — the model supplies only tool INPUTS, never
 * identity or tenancy. Reads return compact, paginated projections (never raw
 * dumps); the two `propose_*` tools write ONLY to the `proposals` queue (never a
 * real table), so accepting a proposal remains the single validated write path.
 */
export function buildTools(sql: Sql, ctx: ToolContext): ToolSet {
  async function propose(
    operation: 'create' | 'update',
    payload: unknown,
    rationale: string | undefined,
    targetId?: string,
  ): Promise<ProposeResult> {
    const tenantId = ctx.tenantId
    if (!tenantId) return { proposed: false, error: 'No tenant in scope' }
    try {
      const row = await createProposal(sql, {
        tenant_id: tenantId,
        run_id: ctx.runId,
        target_type: 'work_item',
        target_id: targetId ?? null,
        operation,
        payload,
        rationale: rationale ?? null,
        model_id: ctx.modelId,
        prompt_version: PROMPT_VERSION,
        actor_type: 'agent',
        actor_id: ctx.runId,
        on_behalf_of: ctx.userId,
        context_ref: ctx.runId,
      })
      return { proposed: true, proposal_id: row.id }
    } catch {
      // Never stream raw DB error text back to the model — a generic refusal only.
      return { proposed: false, error: 'could not create proposal' }
    }
  }

  /**
   * Queue a `target_type='memory'` proposal (P1b) — the agent's write path into the
   * memory brain, disposed of in the SAME Review Inbox as work-item proposals. The
   * payload is operation-shaped free JSON; apply.ts maps it onto the memory domain
   * commands. For every operation that names a target (supersede/retract/defer) the
   * target MUST be the caller-org's memory — validated HERE (a foreign/unknown id is
   * never proposed), a tenant boundary mirrored again at apply time (defence in depth).
   */
  async function proposeMemory(
    operation: 'create' | 'supersede' | 'retract' | 'defer',
    payload: Record<string, unknown>,
    rationale: string | undefined,
    targetId: string | null,
  ): Promise<ProposeResult> {
    const tenantId = ctx.tenantId
    if (!tenantId) return { proposed: false, error: 'No tenant in scope' }
    // Tenant isolation: a non-create op must target THIS org's memory. A foreign or
    // unknown id is indistinguishable (getMemoryScoped → null) and never proposed.
    if (targetId) {
      const target = await getMemoryScoped(sql, targetId, [tenantId]).catch(() => null)
      if (!target) return { proposed: false, error: 'target memory not found in this workspace' }
    }
    try {
      const row = await createProposal(sql, {
        tenant_id: tenantId,
        run_id: ctx.runId,
        target_type: 'memory',
        target_id: targetId,
        operation,
        payload,
        rationale: rationale ?? null,
        model_id: ctx.modelId,
        prompt_version: PROMPT_VERSION,
        actor_type: 'agent',
        actor_id: ctx.runId,
        on_behalf_of: ctx.userId,
        context_ref: ctx.runId,
      })
      return { proposed: true, proposal_id: row.id }
    } catch {
      return { proposed: false, error: 'could not create proposal' }
    }
  }

  const toolset = {
    list_work_items: tool({
      description:
        'List work items in the current workspace, most recent first. Returns a compact projection (id, title, status, priority, team). Optionally filter by team or status.',
      inputSchema: z.object({
        team_id: z.string().optional(),
        status_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ team_id, status_id, limit }): Promise<ItemHit[]> => {
        if (!ctx.tenantId) return []
        const params: unknown[] = [ctx.tenantId]
        let where = 'tenant_id = $1 and archived = false'
        if (team_id) {
          params.push(team_id)
          where += ` and team_id = $${params.length}`
        }
        if (status_id) {
          params.push(status_id)
          where += ` and status_id = $${params.length}`
        }
        params.push(limit ?? 20)
        const text = `
          select id, title, status_id, priority, team_id
          from work_items
          where ${where}
          order by created_at desc
          limit $${params.length}
        `
        const rows = await runQuery<ItemHit>(sql, text, params)
        return rows.map(toHit)
      },
    }),

    get_work_item: tool({
      description:
        'Fetch a single work item by id (scoped to the current workspace). Returns its core fields, or null if not found / not in scope.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        if (!ctx.tenantId) return null
        // Exclude archived, consistent with list_work_items + retrieve — the agent
        // must not read or (via propose_update) target an archived item.
        const text = `
          select id, title, status_id, priority, team_id, description, phase, type
          from work_items
          where id = $1 and tenant_id = $2 and archived = false
          limit 1
        `
        const rows = await runQuery<Record<string, unknown>>(sql, text, [id, ctx.tenantId])
        return rows[0] ?? null
      },
    }),

    search_items: tool({
      description:
        'Search work items by text (title/description) in the current workspace. Returns compact ranked hits. Use this to find relevant items before proposing changes.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: async ({ query, limit }): Promise<ItemHit[]> =>
        retrieve(sql, { tenantIds: ctx.tenantId ? [ctx.tenantId] : [] }, query, limit ?? 8),
    }),

    search_memory: tool({
      description:
        "Search your organization's logged decisions and facts (the memory brain) by text — read this to ground proposals in the org's ACTUAL decisions, not guesses. Returns compact hits (id, kind, title, body, status, topics) — the body carries the decision's rationale/context. Set include_chain to also get a memory's full supersession history (\"why did this flip?\").",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(25).optional(),
        include_chain: z.boolean().optional(),
      }),
      execute: async ({ query, limit, include_chain }) => {
        if (!ctx.tenantId) return { hits: [] }
        const hits = await searchMemories(sql, ctx.tenantId, query, limit ?? 8)
        // Every returned memory logs an attribution (injected_via='tool') — the moat
        // rail. Best-effort: a logging failure must not fail the tool result.
        if (hits.length > 0) {
          await insertAttributions(
            sql,
            { runId: ctx.runId, tenantId: ctx.tenantId, via: 'tool' },
            hits.map((h, i) => ({ memoryId: h.id, rank: i, tokens: null })),
          ).catch((cause) => console.error('[search_memory] attribution failed', cause))
        }
        if (include_chain && hits.length > 0) {
          const chains = await Promise.all(hits.map((h) => resolveChain(sql, ctx.tenantId, h.root_id)))
          return { hits, chains }
        }
        return { hits }
      },
    }),

    propose_create: tool({
      description:
        'Propose creating a new work item. This does NOT create the item — it queues a proposal a human reviews and accepts. Provide a clear title, the target team and status, and a short rationale.',
      inputSchema: z.object({
        title: z.string(),
        team_id: z.string(),
        status_id: z.string(),
        description: z.string().optional(),
        priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        rationale: z.string().optional(),
      }),
      execute: async ({ title, team_id, status_id, description, priority, rationale }): Promise<ProposeResult> => {
        const payload: Record<string, unknown> = { title, team_id, status_id }
        if (description !== undefined) payload.description = description
        if (priority !== undefined) payload.priority = priority
        return propose('create', payload, rationale)
      },
    }),

    propose_update: tool({
      description:
        'Propose updating an existing work item. This does NOT apply the change — it queues a proposal a human reviews. Provide the item id, a patch of the fields to change, and a rationale.',
      inputSchema: z.object({
        id: z.string(),
        patch: z.record(z.string(), z.unknown()),
        rationale: z.string().optional(),
      }),
      execute: async ({ id, patch, rationale }): Promise<ProposeResult> =>
        propose('update', patch, rationale, id),
    }),

    propose_memory: tool({
      description:
        "Propose logging or changing an organizational memory (a decision, fact, or rule in the memory brain). This does NOT save anything — it queues a proposal a human reviews and accepts. Use it when the user asks to remember/log a decision or fact. operation: 'create' logs a NEW memory (needs kind + title); 'supersede' replaces an existing memory with a new version (needs target_id + change_reason); 'retract' marks one no-longer-true (needs target_id); 'defer' parks one (needs target_id). Give a short rationale.",
      inputSchema: proposeMemorySchema,
      execute: async (args): Promise<ProposeResult> => {
        const build = buildMemoryPayload(args)
        if ('error' in build) return { proposed: false, error: build.error }
        return proposeMemory(args.operation, build.payload, args.rationale, build.targetId)
      },
    }),
  } satisfies ToolSet

  // A holdout run must expose NO path into memory — no injected fence AND no
  // search_memory tool — so a suppression bug can't leak the counterfactual through
  // the tool the model could still call. Omit the key entirely (not just disable it).
  if (ctx.holdout) {
    const { search_memory: _omit, ...rest } = toolset
    return rest
  }
  return toolset
}
