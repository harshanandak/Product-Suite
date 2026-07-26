import type { Sql } from '@product-suite/db'

import {
  hasKnownAsker,
  searchMemories,
  type MemoryScopeType,
  type MemorySearchHit,
} from '../agent/memory-retrieval'

import { checkQuality, type CuratorCandidate, type CuratorQualityFinding } from './quality'
import { classifyRelation, scopeCollides, type CuratorCollision, type CuratorRelation } from './relation'

/**
 * THE CURATOR PASS (research rec #3; SAP Signavio's Global Curator, arXiv 2607.03228
 * §5.2). Before a memory proposal reaches a human, diff it against existing memory and
 * present the verdict inline: quality checks in isolation, plus duplicate / overlap /
 * conflict against what is already stored, NAMING the specific colliding memory.
 *
 * ADVISORY, structurally. This module is a pure read — it is not reachable from
 * `proposals/apply.ts` and writes nothing — so it cannot auto-accept, auto-reject, or
 * block an accept. Without it, promotion volume turns the review gate into a rubber
 * stamp, which is how a human gate becomes theatre; with it deciding anything on its
 * own, the gate would stop being human. It informs; the human disposes.
 *
 * OWNERSHIP. The only read of `memories` in this module goes through
 * `searchMemories`, whose org lane is pinned to `visibility='org'` and whose private
 * lane is a separate query bound to `owner_user_id = <asker>` that is never issued when
 * the asker is unknown (#151). The asker here is the REVIEWER reading the Inbox, so the
 * curator can only ever name a memory that reviewer is already entitled to read. Any
 * second path to the table would have to re-derive that guarantee, and re-deriving it is
 * how a surface leaks what the first one correctly hides.
 */

/** The proposal fields the curator reads (a structural subset of `ProposalRow`). */
export interface CuratableProposal {
  target_type: string
  target_id: string | null
  operation: string
  payload: unknown
  edited_payload?: unknown
}

/** The verdict the Review Inbox renders. `outcome` is the headline, most severe first. */
export interface CuratorVerdict {
  outcome: 'not_applicable' | 'conflict' | 'duplicate' | 'overlap' | 'quality_only' | 'clean'
  /** One human-readable sentence. Never a bare score — a reviewer cannot act on 0.4. */
  summary: string
  quality: CuratorQualityFinding[]
  collisions: CuratorCollision[]
  /**
   * True when the reviewer's identity was unknown, so the personal lane was not queried
   * at all. Surfaced rather than hidden: a verdict computed over org memory only is a
   * weaker statement than one computed over both, and saying so beats implying
   * completeness we did not have.
   */
  private_lane_skipped: boolean
  /** Always true. The verdict informs a human decision; it never gates one. */
  advisory: true
}

/** How many FTS probes a single verdict may issue (see decisions D5). */
export const CURATOR_MAX_PROBES = 3

/** Terms per probe. `plainto_tsquery` ANDs them, so a long probe matches nothing. */
export const CURATOR_PROBE_TERMS = 4

/** Hits requested per probe lane. */
export const CURATOR_PROBE_LIMIT = 8

/** Collisions reported. A reviewer reads the worst few, not a list of forty. */
export const CURATOR_MAX_COLLISIONS = 5

/** The memory operations that carry candidate text worth curating. */
const CURATABLE_OPERATIONS = new Set(['create', 'supersede'])

/** Severity order — the verdict's headline is the worst relation found. */
const RELATION_RANK: Record<CuratorRelation, number> = { conflict: 3, duplicate: 2, overlap: 1 }

/**
 * Words too common to narrow an FTS probe. Deliberately a different, smaller list than
 * `relation.ts`'s similarity stopwords: this one exists to keep an ANDed query from
 * matching nothing, not to measure topical closeness.
 */
const PROBE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from',
  'with', 'is', 'are', 'was', 'were', 'be', 'this', 'that', 'it', 'its', 'we', 'our', 'you',
  'they', 'their', 'through', 'when', 'while', 'before', 'after', 'during', 'all', 'any', 'not',
])

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

/**
 * Read the candidate out of a proposal payload. `edited_payload` wins when present, so
 * the verdict describes what an accept would ACTUALLY apply rather than what the agent
 * originally drafted.
 */
function readCandidate(proposal: CuratableProposal): CuratorCandidate | null {
  const edited = proposal.edited_payload
  const source =
    edited && typeof edited === 'object' && !Array.isArray(edited) ? edited : proposal.payload
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const payload = source as Record<string, unknown>

  const title = str(payload, 'title')?.trim()
  // No title is no candidate: there is nothing to probe FTS with and nothing to
  // recognise. The quality checks alone would report `title_missing` against an empty
  // relation pass, which reads as "we looked" when we could not.
  if (!title) return null

  const kind = payload.kind
  const attrs = payload.attrs && typeof payload.attrs === 'object' ? (payload.attrs as Record<string, unknown>) : {}
  const scopeType = payload.scope_type
  const topics = Array.isArray(payload.topics)
    ? payload.topics.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : []

  return {
    kind: kind === 'decision' || kind === 'fact' || kind === 'rule' ? kind : null,
    title,
    body: str(payload, 'body') ?? '',
    topics,
    appliesWhen: typeof attrs.applies_when === 'string' ? attrs.applies_when : null,
    scopeType:
      scopeType === 'project' || scopeType === 'work_item_type' || scopeType === 'work_item'
        ? (scopeType as MemoryScopeType)
        : 'org',
    scopeId: str(payload, 'scope_id'),
  }
}

/**
 * The FTS probes for a candidate: its title's content words (capped), then its topics.
 * Topics are already curated labels, so they are the highest-signal probe available.
 */
export function buildProbes(candidate: CuratorCandidate): string[] {
  const titleTerms = candidate.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !PROBE_STOPWORDS.has(t))
    .slice(0, CURATOR_PROBE_TERMS)

  const probes: string[] = []
  const seen = new Set<string>()
  for (const probe of [titleTerms.join(' '), ...candidate.topics.map((t) => t.trim().toLowerCase())]) {
    if (probe.length === 0 || seen.has(probe)) continue
    seen.add(probe)
    probes.push(probe)
    if (probes.length === CURATOR_MAX_PROBES) break
  }
  return probes
}

function verdict(over: Partial<CuratorVerdict> & { outcome: CuratorVerdict['outcome']; summary: string }): CuratorVerdict {
  return {
    quality: [],
    collisions: [],
    private_lane_skipped: false,
    advisory: true,
    ...over,
  }
}

function notApplicable(summary: string): CuratorVerdict {
  return verdict({ outcome: 'not_applicable', summary })
}

/** The headline sentence — it must name what was found, including which memory. */
function summarise(collisions: CuratorCollision[], quality: CuratorQualityFinding[]): string {
  const worst = collisions[0]
  if (worst) {
    const rest = collisions.length - 1
    const others = rest > 0 ? ` (and ${rest} other related memor${rest > 1 ? 'ies' : 'y'})` : ''
    const tier = worst.visibility === 'private' ? 'your own private note' : 'an org memory'
    const verb =
      worst.relation === 'conflict'
        ? 'contradicts'
        : worst.relation === 'duplicate'
          ? 'duplicates'
          : 'overlaps with'
    return `This ${verb} ${tier}: “${worst.title}” (${worst.memory_id})${others}.`
  }
  if (quality.length > 0) {
    return `Nothing in memory collides with this, but ${quality.length === 1 ? 'one thing' : `${quality.length} things`} about how it is written would make it hard to use: ${quality[0]!.reason}`
  }
  return 'Nothing in memory duplicates, overlaps with, or contradicts this, and it is well-formed on its own.'
}

/**
 * Compute the curator verdict for one memory proposal.
 *
 * `reviewerUserId` is the human reading the Inbox. It is passed straight through as the
 * private lane's asker, so an unknown reviewer gets an org-only verdict rather than an
 * unfiltered one.
 */
export async function curateProposal(
  sql: Sql,
  proposal: CuratableProposal,
  input: { tenantId: string; reviewerUserId?: string | null },
): Promise<CuratorVerdict> {
  if (proposal.target_type !== 'memory') {
    return notApplicable('Only memory proposals are curated.')
  }
  if (!CURATABLE_OPERATIONS.has(proposal.operation)) {
    return notApplicable(
      `A ${proposal.operation} carries no candidate text, so there is nothing to check in isolation and nothing to diff against memory.`,
    )
  }

  const candidate = readCandidate(proposal)
  if (!candidate) {
    return notApplicable('This proposal states no memory title, so there is nothing to curate.')
  }

  const privateLaneSkipped = !hasKnownAsker(input.reviewerUserId)
  const quality = checkQuality(candidate)

  // ONE path to `memories`, run per probe. Hits are unioned by id, so a memory found by
  // two probes is reported once.
  const hits = new Map<string, MemorySearchHit>()
  for (const probe of buildProbes(candidate)) {
    const found = await searchMemories(
      sql,
      input.tenantId,
      probe,
      CURATOR_PROBE_LIMIT,
      input.reviewerUserId,
    )
    for (const hit of found) if (!hits.has(hit.id)) hits.set(hit.id, hit)
  }

  const collisions: CuratorCollision[] = []
  for (const hit of hits.values()) {
    // A supersede's candidate text is by construction near-identical to the row it
    // replaces, so the row it replaces is not a collision. No extra query is needed to
    // exclude it: only one row per chain is `active`, and these lanes return only
    // active rows, so the superseded ancestors were never candidates.
    if (proposal.target_id !== null && hit.id === proposal.target_id) continue
    if (!scopeCollides(candidate, hit)) continue
    const collision = classifyRelation(candidate, {
      id: hit.id,
      title: hit.title,
      body: hit.body,
      visibility: hit.visibility,
      scope_type: hit.scope_type,
      scope_id: hit.scope_id,
    })
    if (collision) collisions.push(collision)
  }

  collisions.sort(
    (a, b) => RELATION_RANK[b.relation] - RELATION_RANK[a.relation] || b.similarity - a.similarity,
  )
  const reported = collisions.slice(0, CURATOR_MAX_COLLISIONS)

  const outcome: CuratorVerdict['outcome'] =
    reported[0]?.relation ?? (quality.length > 0 ? 'quality_only' : 'clean')

  return verdict({
    outcome,
    summary: summarise(reported, quality),
    quality,
    collisions: reported,
    private_lane_skipped: privateLaneSkipped,
  })
}
