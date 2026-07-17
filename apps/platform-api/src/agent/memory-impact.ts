import type { Sql } from '@product-suite/db'

/**
 * Memory-impact metric: does memory (treated) measurably reduce the human editing
 * burden vs. the holdout (memory-off) cohort, restricted to `chat` runs (excludes
 * reflection runs, which are `kind='agent_run'` and never user-facing edits)?
 *
 * The comparison is a two-proportion (edit rate) difference with a Newcombe (Wilson)
 * 95% CI — no normal approximation, valid at small N. `decideVerdict` additionally
 * guards against a confounded read: if REJECT rates diverge materially between
 * cohorts, a different population/traffic mix is likely at play, not memory itself
 * (a collider), so we report `insufficient` rather than a spurious help/hurt call.
 */

export const MIN_SAMPLE = 20
export const REJECT_DIVERGENCE = 0.1
/**
 * Minimum DISTINCT applied-proposal threads per cohort before a help/hurt call.
 * The Newcombe CI treats proposals as independent, but holdout assignment (and the
 * correlation between a thread's proposals) is per-THREAD: a handful of chatty
 * threads can produce many proposals whose CI is falsely narrow, unlocking the
 * headline on effectively little independent evidence. Requiring ≥5 distinct threads
 * per cohort is an honest INTERIM conservatism until a thread-clustered/bootstrap CI
 * lands (§6 deferred). It never loosens the existing gates — only adds one.
 */
export const MIN_THREADS = 5
const Z = 1.959963984540054 // 95%

/** Wilson score interval for a single proportion. */
function wilson(x: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 }
  const p = x / n
  const z2 = Z * Z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { lo: center - half, hi: center + half }
}

/** Newcombe (method 10) 95% CI for p1 − p2 from Wilson single-proportion intervals. */
export function newcombeDiffCI(x1: number, n1: number, x2: number, n2: number): { lower: number; upper: number } {
  const p1 = n1 ? x1 / n1 : 0
  const p2 = n2 ? x2 / n2 : 0
  const w1 = wilson(x1, n1)
  const w2 = wilson(x2, n2)
  const d = p1 - p2
  const lower = d - Math.sqrt((p1 - w1.lo) ** 2 + (w2.hi - p2) ** 2)
  const upper = d + Math.sqrt((w1.hi - p1) ** 2 + (p2 - w2.lo) ** 2)
  return { lower, upper }
}

interface VerdictInput {
  holdout: { applied: number; rejected: number; rejectRate: number; threads: number }
  treated: { applied: number; rejected: number; rejectRate: number; threads: number }
  ciLow: number
  ciHigh: number
}

export function decideVerdict(v: VerdictInput): 'helps' | 'hurts' | 'insufficient' {
  if (v.holdout.applied < MIN_SAMPLE || v.treated.applied < MIN_SAMPLE) return 'insufficient'
  // Thread-clustering guard: too few DISTINCT threads means the proposal-level CI is
  // anti-conservative (correlated within-thread), so decline the headline regardless
  // of how many proposals those threads produced.
  if (v.holdout.threads < MIN_THREADS || v.treated.threads < MIN_THREADS) return 'insufficient'
  if (Math.abs(v.holdout.rejectRate - v.treated.rejectRate) > REJECT_DIVERGENCE) return 'insufficient'
  if (v.ciLow > 0) return 'helps' // holdout edits MORE than treated ⇒ memory helped
  if (v.ciHigh < 0) return 'hurts'
  return 'insufficient'
}

export interface Cohort { applied: number; edited: number; editRate: number; rejected: number; rejectRate: number; threads: number }
export interface MemoryImpact {
  window_days: number
  holdout: Cohort
  treated: Cohort
  delta: number
  savedEdits: number
  /** Lower bound of the 95% CI on the EDIT-RATE DELTA (holdout − treated), not on savedEdits. */
  ciLow: number
  /** Upper bound of the 95% CI on the EDIT-RATE DELTA (holdout − treated), not on savedEdits. */
  ciHigh: number
  verdict: 'helps' | 'hurts' | 'insufficient'
}

function runQuery<Row>(sql: Sql, text: string, params: unknown[]): Promise<Row[]> {
  return (sql as unknown as { query: (q: string, p: unknown[]) => Promise<Row[]> }).query(text, params)
}

function cohort(applied: number, edited: number, rejected: number, threads: number): Cohort {
  return {
    applied, edited, rejected, threads,
    editRate: applied ? edited / applied : 0,
    rejectRate: applied + rejected ? rejected / (applied + rejected) : 0,
  }
}

/**
 * The metric itself: compares edit rates (a proxy for output quality — did the human
 * have to fix it?) between the memory-off holdout and the memory-on treated cohort,
 * for `chat` runs decided within the trailing window. `savedEdits` is the honest
 * count this gates — SIGNED, so a `hurts` verdict surfaces as a negative number
 * rather than being floored away.
 */
export async function computeMemoryImpact(sql: Sql, tenantIds: string[], windowDays = 30): Promise<MemoryImpact> {
  // One grouped aggregate: applied + edited + rejected (+ distinct applied threads) per
  // holdout cohort, chat runs only. `threads` feeds the MIN_THREADS clustering guard.
  const rows = await runQuery<{ memory_holdout: boolean; applied: number; edited: number; rejected: number; threads: number }>(
    sql,
    `select r."memory_holdout",
        count(*) filter (where p.status = 'applied')::int as applied,
        count(*) filter (where p.status = 'applied' and p.edited_payload is not null)::int as edited,
        count(*) filter (where p.status = 'rejected')::int as rejected,
        count(distinct r.thread_id) filter (where p.status = 'applied')::int as threads
     from "proposals" p
     join "agent_runs" r on r.id = p.run_id
     where p.tenant_id = any($1) and r.kind = 'chat'
       and p.decided_at >= now() - ($2 || ' days')::interval
     group by r."memory_holdout"`,
    [tenantIds, String(windowDays)],
  )
  const h = rows.find((x) => x.memory_holdout) ?? { applied: 0, edited: 0, rejected: 0, threads: 0 }
  const t = rows.find((x) => !x.memory_holdout) ?? { applied: 0, edited: 0, rejected: 0, threads: 0 }
  const holdout = cohort(h.applied, h.edited, h.rejected, h.threads)
  const treated = cohort(t.applied, t.edited, t.rejected, t.threads)
  const delta = holdout.editRate - treated.editRate
  const { lower: ciLow, upper: ciHigh } = newcombeDiffCI(holdout.edited, holdout.applied, treated.edited, treated.applied)
  const verdict = decideVerdict({ holdout, treated, ciLow, ciHigh })
  return { window_days: windowDays, holdout, treated, delta, savedEdits: Math.round(delta * treated.applied), ciLow, ciHigh, verdict }
}
