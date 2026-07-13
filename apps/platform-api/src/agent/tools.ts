import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type { Sql } from '@product-suite/db'

import { createProposal } from '../proposals/repository'
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
}

/** Outcome of a `propose_*` tool: a queued proposal id, or a refusal reason. */
type ProposeResult = { proposed: true; proposal_id: string } | { proposed: false; error: string }

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

  return {
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
        const text = `
          select id, title, status_id, priority, team_id, description, phase, type
          from work_items
          where id = $1 and tenant_id = $2
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
  }
}
