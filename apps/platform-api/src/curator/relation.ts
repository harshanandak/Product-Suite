import type { MemoryScopeType, MemoryVisibility } from '../agent/memory-retrieval'

import type { CuratorCandidate } from './quality'

/**
 * RELATION-TO-EXISTING — the second half of SAP's Global Curator (research §1.10B):
 * does this candidate DUPLICATE, OVERLAP with, or CONFLICT with a memory already in the
 * store? The paper's R3 requirement is conflict detection and resolution; we detect and
 * name, and a human resolves (never auto-resolve — that is the review gate's whole
 * point).
 *
 * Pure and synchronous. Candidate lookup is NOT here: `curate.ts` obtains candidates
 * through `searchMemories` and this module only classifies what came back, so the
 * ownership boundary is enforced in exactly one place.
 */

/** How a candidate relates to one existing memory, most severe first. */
export type CuratorRelation = 'conflict' | 'duplicate' | 'overlap'

/**
 * "The same thing, said twice". Reuses the 0.82 figure this codebase already settled on
 * for cross-tier similarity (`contradiction-detection-review-inbox-26708faa`) rather
 * than introducing a second, competing similarity vocabulary.
 */
export const DUPLICATE_THRESHOLD = 0.82

/** "About the same thing" — the floor for reporting any relation at all. */
export const OVERLAP_THRESHOLD = 0.4

/** An existing memory, exactly as `searchMemories` returns it (no extra reads). */
export interface ExistingMemory {
  id: string
  title: string
  body: string
  kind: string
  visibility: MemoryVisibility
  scope_type: MemoryScopeType
  scope_id: string | null
}

/** One named collision: which memory, how it relates, and why — in words. */
export interface CuratorCollision {
  relation: CuratorRelation
  memory_id: string
  title: string
  visibility: MemoryVisibility
  scope_type: MemoryScopeType
  similarity: number
  reason: string
}

/**
 * Function words carry no topic signal, so leaving them in would let two memories about
 * completely different things score as related purely on English grammar.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'at', 'by', 'for', 'from', 'in',
  'into', 'of', 'on', 'to', 'with', 'without', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'we', 'our', 'us', 'you', 'your',
  'they', 'their', 'them', 'i', 'my', 'me', 'he', 'she', 'his', 'her', 'has', 'have', 'had', 'do',
  'does', 'did', 'will', 'would', 'can', 'could', 'may', 'might', 'any', 'all', 'each', 'per',
  'up', 'out', 'over', 'under', 'about', 'than', 'when', 'while', 'before', 'after', 'during',
  'goes', 'go', 'get', 'gets', 'also', 'not',
])

/** Content tokens of a text: lowercased words, stopwords dropped, deduplicated. */
function tokenSet(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
  return new Set(tokens)
}

/**
 * Dice coefficient over content-token sets: `2·|A∩B| / (|A|+|B|)`.
 *
 * Chosen over embeddings deliberately — the curator must stay a synchronous,
 * deterministic, EXPLAINABLE read. A reviewer can be shown which words matched; a
 * cosine distance over a vector cannot be shown to anyone. The cost is lexical recall
 * (see decisions D5/D9), which is a known and stated limit, not a hidden one.
 */
export function similarity(a: string, b: string): number {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

/** Markers that FORBID rather than require — the polarity half of conflict detection. */
const NEGATIVE_DIRECTIVE_RE =
  /\b(must not|mustn't|shall not|shan't|should not|shouldn't|cannot|can't|may not|never|no longer|do not|don't|prohibited|forbidden|not allowed|not permitted|disallowed)\b/i

/** Numbers stated in a text — thresholds, limits, amounts. */
function numbersIn(text: string): string[] {
  return (text.match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).map((n) => n.replace(/,/g, ''))
}

function sameNumbers(a: string[], b: string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

/**
 * Do these two scopes put the memories in each other's way? Four explainable cases,
 * because proving real containment (is work item W inside project P?) needs the object
 * graph, which this read does not have and must not go fetch.
 */
export function scopeCollides(
  candidate: { scopeType: MemoryScopeType; scopeId: string | null },
  existing: { scope_type: MemoryScopeType; scope_id: string | null },
): boolean {
  // Org policy binds everywhere, so it is in the way of anything narrower...
  if (existing.scope_type === 'org') return true
  // ...and symmetrically, an org-scoped candidate would bind over everything narrower.
  if (candidate.scopeType === 'org') return true
  // The identical narrow scope: both would be retrieved together.
  return candidate.scopeType === existing.scope_type && candidate.scopeId === existing.scope_id
}

function label(existing: ExistingMemory): string {
  return `“${existing.title}” (${existing.id})`
}

/**
 * Classify the candidate against ONE existing memory, or `null` when they are not
 * related enough to be worth a reviewer's attention.
 *
 * Precedence is conflict > duplicate > overlap. A negated near-copy scores as a
 * near-duplicate on token overlap, because only one word differs — so if duplicate won,
 * a contradiction entering memory would be reported as the most benign outcome
 * available. Conflict must win on the same evidence.
 */
export function classifyRelation(
  candidate: CuratorCandidate,
  existing: ExistingMemory,
): CuratorCollision | null {
  const candidateText = `${candidate.title} ${candidate.body}`
  const existingText = `${existing.title} ${existing.body}`
  const score = similarity(candidateText, existingText)
  if (score < OVERLAP_THRESHOLD) return null

  const rounded = Math.round(score * 100) / 100
  const base = {
    memory_id: existing.id,
    title: existing.title,
    visibility: existing.visibility,
    scope_type: existing.scope_type,
    similarity: rounded,
  }

  // CONFLICT 1 — polarity. Exactly one of the two texts forbids something, while both
  // are about the same thing.
  const candidateForbids = NEGATIVE_DIRECTIVE_RE.test(candidateText)
  const existingForbids = NEGATIVE_DIRECTIVE_RE.test(existingText)
  if (candidateForbids !== existingForbids) {
    const forbidding = existingForbids ? label(existing) : 'this candidate'
    const permitting = existingForbids ? 'this candidate' : label(existing)
    return {
      ...base,
      relation: 'conflict',
      reason: `These two are about the same thing but take opposite positions: ${forbidding} forbids it, while ${permitting} does not. Accepting both would put a contradiction into memory.`,
    }
  }

  // CONFLICT 2 — thresholds. Both state a number, and the numbers disagree (SAP's own
  // worked example: an SOP allowing deviations below EUR 250 against a plant policy
  // with a lower threshold).
  const candidateNumbers = numbersIn(candidateText)
  const existingNumbers = numbersIn(existingText)
  if (
    candidateNumbers.length > 0 &&
    existingNumbers.length > 0 &&
    !sameNumbers(candidateNumbers, existingNumbers)
  ) {
    return {
      ...base,
      relation: 'conflict',
      reason: `Both state a figure and the figures disagree: this candidate says ${candidateNumbers.join(', ')} where ${label(existing)} says ${existingNumbers.join(', ')}. One of the two thresholds is wrong.`,
    }
  }

  if (score >= DUPLICATE_THRESHOLD) {
    return {
      ...base,
      relation: 'duplicate',
      reason: `This says essentially what ${label(existing)} already says. Logging it again would create a second copy that has to be superseded separately.`,
    }
  }

  return {
    ...base,
    relation: 'overlap',
    reason: `This covers ground that ${label(existing)} already covers. Check whether it should supersede that memory rather than sit beside it.`,
  }
}
