/**
 * Deterministic authority layer for the memory brain's unified knowledge state
 * (P3a). Every retrievable item — a pinned rule, an active memory, a curated
 * doc, a work-item chunk, a meeting aside — carries an authority TIER. Lower
 * tier number = more authoritative. These functions are pure: no DB, no I/O,
 * no network. They exist so ranking and conflict-annotation are reproducible
 * and testable in isolation from retrieval/storage (see `retrieve.ts`,
 * `memory-retrieval.ts` for the I/O side).
 *
 * Tiers:
 *   0 — pinned `hard`-enforcement rule (never overridden)
 *   1 — active decision / rule / fact (a memory)
 *   2 — curated doc (P3b — not exercised until that phase)
 *   3 — work-item chunk (default for untyped/unrecognized items)
 *   4 — meeting aside (P3c — not exercised until that phase)
 */

/** Loose input shape accepted by `resolveTier` — callers pass whatever fields their item has. */
export interface TierInput {
  kind?: 'memory' | 'chunk' | string
  memKind?: 'decision' | 'rule' | 'fact' | string
  pinned?: boolean
  enforcement?: 'hard' | 'soft' | string
  sourceType?: 'doc' | 'work_item' | 'meeting' | string
}

export type AuthorityTier = 0 | 1 | 2 | 3 | 4

/**
 * Resolve an item's authority tier. Memories are pinned-hard-rules (tier 0)
 * or active decisions/rules/facts (tier 1); chunks are classified by
 * `sourceType` (doc → 2, work_item → 3 default, meeting → 4).
 */
export function resolveTier(item: TierInput): AuthorityTier {
  if (item.kind === 'memory') {
    // Tier 0 is reserved for a pinned, hard-enforcement RULE (file header line 11).
    // A pinned hard *decision* or *fact* is not a rule, so it falls through to tier 1.
    if (item.pinned === true && item.enforcement === 'hard' && item.memKind === 'rule') return 0
    return 1
  }
  if (item.kind === 'chunk') {
    switch (item.sourceType) {
      case 'doc':
        return 2
      case 'meeting':
        return 4
      case 'work_item':
      default:
        return 3
    }
  }
  // Unrecognized kind: default to the work-item-chunk tier rather than
  // silently granting elevated authority.
  return 3
}

const SCOPE_SPECIFICITY_RANK: Record<string, number> = {
  work_item: 0,
  work_item_type: 1,
  project: 2,
  org: 3,
}

/** Least-specific rank for scope types we don't recognize — sorts last among ties. */
const UNKNOWN_SCOPE_RANK = Object.keys(SCOPE_SPECIFICITY_RANK).length

/** Shape `compareByAuthority` and `annotateByAuthority` rank on. */
export interface AuthorityRankable {
  tier: AuthorityTier
  scopeType?: string
  eventTime?: string | number | Date
  priority?: number
}

function eventTimeMs(value: string | number | Date | undefined): number {
  if (value === undefined) return 0
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Comparator for sorting items by authority: tier ascending (0 = most
 * authoritative, first) → scope specificity (more specific scope first) →
 * event time descending (newer first) → priority descending. Negative
 * return means `a` ranks before `b`. Suitable for `Array.prototype.sort`
 * (stable in the JS engines this codebase targets).
 */
export function compareByAuthority<T extends AuthorityRankable>(a: T, b: T): number {
  if (a.tier !== b.tier) return a.tier - b.tier

  const scopeRankA = SCOPE_SPECIFICITY_RANK[a.scopeType ?? ''] ?? UNKNOWN_SCOPE_RANK
  const scopeRankB = SCOPE_SPECIFICITY_RANK[b.scopeType ?? ''] ?? UNKNOWN_SCOPE_RANK
  if (scopeRankA !== scopeRankB) return scopeRankA - scopeRankB

  const timeA = eventTimeMs(a.eventTime)
  const timeB = eventTimeMs(b.eventTime)
  if (timeA !== timeB) return timeB - timeA // newer first

  const priorityA = a.priority ?? 0
  const priorityB = b.priority ?? 0
  return priorityB - priorityA // higher priority first
}

/** Cosine similarity between two equal-length embedding vectors. Returns 0 for zero-magnitude vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    magA += ai * ai
    magB += bi * bi
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/** Similarity threshold above which a lower-authority item is annotated as conflicting/duplicating a higher-authority one. */
export const ANNOTATE_SIM_THRESHOLD = 0.82

/**
 * The highest tier that may serve as an annotation REFERENT. The annotation reads
 * "see decision: <title>", so the referent must be a MEMORY (T0 pinned rule or T1
 * active decision/rule/fact) — never a doc (T2), work-item chunk (T3), or meeting
 * (T4), which are not "decisions" and would be misleading to point at.
 */
const ANNOTATE_MAX_REFERENT_TIER = 1

/** Item shape `annotateByAuthority` operates on. */
export interface AnnotatableItem extends AuthorityRankable {
  id: string
  title: string
  embedding?: number[]
  annotation?: string
}

/**
 * Find the best MEMORY referent for `item`: the most authoritative (lowest-tier)
 * memory in the set (tier ≤ {@link ANNOTATE_MAX_REFERENT_TIER}) that is more
 * authoritative than `item` and cosine-similar ≥ `ANNOTATE_SIM_THRESHOLD`. Ties
 * on tier break toward the higher similarity. Returns its title, or null.
 */
function findBestMemoryReferent<T extends AnnotatableItem>(item: T, items: T[]): string | null {
  if (!item.embedding) return null
  let best: { title: string; tier: AuthorityTier; sim: number } | null = null

  for (const other of items) {
    if (other === item) continue
    if (other.tier > ANNOTATE_MAX_REFERENT_TIER) continue // referent must be a memory
    if (other.tier >= item.tier) continue // only more-authoritative items can annotate
    if (!other.embedding) continue

    const sim = cosineSimilarity(item.embedding, other.embedding)
    if (sim < ANNOTATE_SIM_THRESHOLD) continue

    if (!best || other.tier < best.tier || (other.tier === best.tier && sim > best.sim)) {
      best = { title: other.title, tier: other.tier, sim }
    }
  }

  return best ? best.title : null
}

/**
 * For each item, look for the most authoritative MEMORY (tier ≤
 * {@link ANNOTATE_MAX_REFERENT_TIER}) in the set whose embedding is cosine-similar
 * ≥ `ANNOTATE_SIM_THRESHOLD`. If found, stamp `annotation = "see decision: <that
 * memory's title>"`. Then stable-sort the whole (shallow-cloned) list by
 * `compareByAuthority`. Does not mutate the input array or its items.
 */
export function annotateByAuthority<T extends AnnotatableItem>(items: T[]): T[] {
  const out = items.map((item) => ({ ...item }))

  for (const item of out) {
    const referent = findBestMemoryReferent(item, out)
    if (referent) item.annotation = `see decision: ${referent}`
  }

  out.sort(compareByAuthority)
  return out
}
