import { generateText, type LanguageModel } from 'ai'
import { Hono } from 'hono'

import { agentModel } from '../agent/models'
import { runReflection, type Cluster } from '../agent/reflection'
import { callerTenantIds } from '../auth/tenant-scope'
import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'

/**
 * Reflection: a headless job that mines recent human corrections (applied,
 * human-edited work-item proposals) into `kind='rule'` memory proposals, through
 * the SAME review queue as every other proposal. Nothing is written directly —
 * the rule takes effect only when a human accepts it. Anchored to ONE org per run
 * (mirrors the chat + threads routes), so nothing crosses tenants.
 */
export const agentReflectionRoutes = new Hono<AuthedEnv>()

/**
 * Resolve the single org the run anchors to: the requested `org_id` when the caller
 * belongs to it, else their sole org, else ambiguous. Mirrors the chat/threads routes.
 */
function resolveAnchor(
  tenantIds: string[],
  orgId: string | undefined,
): { ok: true; tenantId: string } | { ok: false } {
  if (orgId && tenantIds.includes(orgId)) return { ok: true, tenantId: orgId }
  if (orgId) return { ok: false }
  if (tenantIds.length === 1) return { ok: true, tenantId: tenantIds[0]! }
  return { ok: false }
}

/** A compact, injection-safe description of what a cluster's corrections changed. */
function describeCluster(cluster: Cluster): string {
  const lines = cluster.diffs.slice(0, 12).map((d) => {
    const from = JSON.stringify(d.from)
    const to = JSON.stringify(d.to)
    return `- field ${JSON.stringify(d.field)}: ${from} -> ${to}`
  })
  return `Field-set: ${cluster.fieldSetKey}\nExamples (${cluster.corrections.length} corrections):\n${lines.join('\n')}`
}

/**
 * The real LLM distiller: one call over a cluster's diffs → a single atomic rule
 * `{ directive, applies_when }`, or `null` to skip the cluster. DEFENSIVE by
 * contract — any failure (network, non-JSON reply, wrong shape, explicit null)
 * returns `null` so a bad reply skips the cluster; it MUST NEVER throw, because a
 * single low-signal cluster must not fail the whole reflection run.
 */
async function distillRuleFromCluster(
  model: LanguageModel,
  cluster: Cluster,
): Promise<{ directive: string; applies_when: string } | null> {
  try {
    const prompt = [
      'You review recurring human corrections to AI-proposed work items.',
      'Below are proposals a human edited the SAME way. Distill ONE atomic, reusable',
      'rule the agent should follow next time so the human need not repeat this edit.',
      '',
      describeCluster(cluster),
      '',
      'Reply with STRICT JSON only, no prose, no code fence:',
      '{"directive": "<imperative rule, one sentence>", "applies_when": "<when it applies>"}',
      'If the pattern is low-signal or not a generalizable rule, reply exactly: null',
    ].join('\n')

    const { text } = await generateText({ model, prompt })
    const parsed: unknown = JSON.parse(extractJson(text))
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { directive?: unknown; applies_when?: unknown }
    if (typeof obj.directive !== 'string' || obj.directive.trim() === '') return null
    if (typeof obj.applies_when !== 'string' || obj.applies_when.trim() === '') return null
    return { directive: obj.directive.trim(), applies_when: obj.applies_when.trim() }
  } catch {
    // Network error, unparseable reply, or wrong shape — skip this cluster, never throw.
    return null
  }
}

/** Pull the first JSON object/`null` out of a reply that may carry stray prose or a fence. */
function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed === 'null') return 'null'
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

/**
 * POST /api/agent/reflection/run — mine recent corrections into rule proposals.
 * 403 when the caller belongs to no org; 400 when a multi-org caller does not
 * disambiguate. The response is the {@link runReflection} result.
 */
agentReflectionRoutes.post('/run', async (c) => {
  const claims = c.get('claims')
  const sql = sqlFrom(c.env ?? {})

  try {
    const tenantIds = await callerTenantIds(sql, claims)
    if (tenantIds.length === 0) return c.json({ error: 'No active organization' }, 403)

    const body = (await c.req.json().catch(() => ({}))) as { org_id?: string }
    const anchor = resolveAnchor(tenantIds, body.org_id)
    if (!anchor.ok) return c.json({ error: 'Ambiguous organization; specify org_id' }, 400)

    const model = agentModel(c.env ?? {})
    const modelId = typeof model === 'string' ? model : ((model as { modelId?: string }).modelId ?? null)
    const distill = (cluster: Cluster) => distillRuleFromCluster(model, cluster)

    const result = await runReflection(sql, {
      tenantId: anchor.tenantId,
      now: new Date(),
      distill,
      modelId,
    })
    return c.json(result)
  } catch (cause) {
    console.error('[agent-reflection] run failed', cause)
    return c.json({ error: 'Failed to run reflection' }, 500)
  }
})
