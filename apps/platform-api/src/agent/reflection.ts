import type { Sql } from '@product-suite/db'

import { createProposal } from '../proposals/repository'

/** Minimum recurrences before a correction pattern becomes a rule proposal. */
export const RECURRENCE_THRESHOLD = 2
/** Lookback window for corrections (days). */
export const REFLECTION_WINDOW_DAYS = 30
/** The provenance stamped on reflection-authored proposals. */
export const REFLECTION_PROMPT_VERSION = 'reflection-v1'

export interface Correction {
  proposalId: string
  targetType: string
  payload: Record<string, unknown>
  editedPayload: Record<string, unknown>
}
export interface FieldDiff {
  field: string
  from: unknown
  to: unknown
}
export interface Cluster {
  fieldSetKey: string
  corrections: Correction[]
  diffs: FieldDiff[]
}

/** The set of fields whose value changed between payload and editedPayload. */
function changedFields(c: Correction): FieldDiff[] {
  const keys = new Set([...Object.keys(c.payload), ...Object.keys(c.editedPayload)])
  const diffs: FieldDiff[] = []
  for (const k of keys) {
    const before = c.payload[k]
    const after = c.editedPayload[k]
    if (JSON.stringify(before) !== JSON.stringify(after)) diffs.push({ field: k, from: before, to: after })
  }
  return diffs
}

/** Cluster corrections by their changed-field-set; keep only clusters >= threshold. */
export function clusterCorrections(corrections: Correction[]): Cluster[] {
  const byKey = new Map<string, { corrections: Correction[]; diffs: FieldDiff[] }>()
  for (const c of corrections) {
    const diffs = changedFields(c)
    if (diffs.length === 0) continue
    const key = diffs.map((d) => d.field).sort((a, b) => a.localeCompare(b)).join('+')
    const entry = byKey.get(key) ?? { corrections: [], diffs: [] }
    entry.corrections.push(c)
    entry.diffs.push(...diffs)
    byKey.set(key, entry)
  }
  const out: Cluster[] = []
  for (const [fieldSetKey, entry] of byKey) {
    if (entry.corrections.length >= RECURRENCE_THRESHOLD) {
      out.push({ fieldSetKey, corrections: entry.corrections, diffs: entry.diffs })
    }
  }
  return out
}

export interface RunReflectionCtx {
  tenantId: string
  now: Date
  windowDays?: number
  threshold?: number
  /** Injected LLM: distill a cluster into a rule, or null to skip. Tests mock this. */
  distill: (cluster: Cluster) => Promise<{ directive: string; applies_when: string } | null>
  modelId?: string | null
}
export interface ReflectionResult {
  proposalsCreated: number
  ruleProposalIds: string[]
  consumedProposalIds: string[]
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

export async function runReflection(sql: Sql, ctx: RunReflectionCtx): Promise<ReflectionResult> {
  const windowDays = ctx.windowDays ?? REFLECTION_WINDOW_DAYS
  const since = new Date(ctx.now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  // 1. Gather corrections: applied work-item proposals edited by a human, not yet mined.
  const rows = await runQuery<{ id: string; target_type: string; payload: unknown; edited_payload: unknown }>(
    sql,
    `select id, target_type, payload, edited_payload
     from "proposals"
     where tenant_id = $1 and status = 'applied' and target_type = 'work_item'
       and edited_payload is not null and reflected_at is null and created_at >= $2`,
    [ctx.tenantId, since],
  )
  const corrections: Correction[] = rows.map((r) => ({
    proposalId: r.id,
    targetType: r.target_type,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    editedPayload: (r.edited_payload ?? {}) as Record<string, unknown>,
  }))

  const clusters = clusterCorrections(corrections)
  if (clusters.length === 0) return { proposalsCreated: 0, ruleProposalIds: [], consumedProposalIds: [] }

  // 2. Mint the reflection run — the attributable actor (satisfies apply.ts run_id + the
  //    source_run_id FK). triggered_by='reflection' is a reserved sentinel (not a user id).
  const runRows = await runQuery<{ id: string }>(
    sql,
    `insert into "agent_runs" ("tenant_id", "triggered_by", "kind", "status", "memory_holdout")
     values ($1, 'reflection', 'agent_run', 'running', false) returning id`,
    [ctx.tenantId],
  )
  const runId = runRows[0]!.id

  const ruleProposalIds: string[] = []
  const consumedProposalIds: string[] = []
  for (const cluster of clusters) {
    const rule = await ctx.distill(cluster)
    if (!rule) continue // model declined — leave the cluster unmined
    const evidence = cluster.corrections.map((c) => c.proposalId)
    const proposal = await createProposal(sql, {
      tenant_id: ctx.tenantId,
      run_id: runId,
      target_type: 'memory',
      operation: 'create', // dedup→supersede is a fast-follow; create is correct + safe
      payload: {
        kind: 'rule',
        title: rule.directive,
        body: `Learned from ${evidence.length} similar corrections.`,
        attrs: { applies_when: rule.applies_when, evidence_proposal_ids: evidence },
        enforcement: 'advisory',
      },
      rationale: `Recurring correction to [${cluster.fieldSetKey}] across ${evidence.length} proposals.`,
      model_id: ctx.modelId ?? null,
      prompt_version: REFLECTION_PROMPT_VERSION,
      actor_type: 'agent',
      actor_id: runId,
      context_ref: runId,
    })
    ruleProposalIds.push(proposal.id)
    consumedProposalIds.push(...evidence)
  }

  // 3. Stamp ONLY the consumed corrections (sub-threshold ones stay NULL to mature).
  //    Each id is its own bound param ($2, $3, …) — not a single array param — so the
  //    stamp is a plain `id in (...)` list (works on any driver, no array-type binding).
  if (consumedProposalIds.length > 0) {
    const placeholders = consumedProposalIds.map((_, i) => `$${i + 2}`).join(', ')
    await runQuery(
      sql,
      `update "proposals" set reflected_at = now() where tenant_id = $1 and id in (${placeholders})`,
      [ctx.tenantId, ...consumedProposalIds],
    )
  }
  await runQuery(sql, `update "agent_runs" set status = 'completed' where id = $1`, [runId])

  return { proposalsCreated: ruleProposalIds.length, ruleProposalIds, consumedProposalIds }
}
