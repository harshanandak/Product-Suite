import type { CreateMemoryInput } from '../domain/memories'

import { UNDO_KEY } from './undo'

/**
 * Capture-on-accept — the episodic half of the memory layer.
 *
 * When a human accepts a work-item proposal, the decision itself is worth
 * remembering: an agent proposed something, a person looked at it and said yes,
 * and a specific set of fields moved as a result. Today that reasoning evaporates
 * the moment the write lands.
 *
 * Two rules shape everything here:
 *
 *  - **A memory must carry what the `proposals` row does not already hold
 *    queryably.** "Accepted proposal p1" is a restatement, and a store full of
 *    restatements is landfill that poisons retrieval later. What is genuinely new
 *    is the human's reasoning plus the concrete field-level change.
 *  - **Capture costs the reviewer nothing.** It is a side effect of accepting,
 *    never a second action — capture friction is what kills memory layers. So the
 *    content is template-generated and deterministic: no LLM call inside the
 *    accept request, which would add latency, a new failure mode, and
 *    non-deterministic content to a path built on deterministic re-drive.
 *
 * This module is deliberately PURE. `apply.ts` is the riskiest file in the
 * codebase, so the decision of what to record lives here and is tested here; the
 * call site is a few lines that cannot fail an accept.
 */

/** The proposal fields capture reads. */
export interface CapturableProposal {
  readonly id: string
  readonly tenant_id: string
  readonly run_id: string | null
  readonly target_type: string
  readonly target_id: string | null
  readonly operation: string
  readonly rationale: string | null
  readonly edited_payload: unknown
}

/** Longest title we will store; the full text always survives in the body. */
const TITLE_LIMIT = 160

/**
 * Is this accept worth remembering?
 *
 * A bare accept — no rationale from the agent, no edit from the reviewer — adds
 * nothing the `proposals` row does not already say, so it is skipped. An edit
 * counts even when unexplained: the reviewer disagreed with the agent and
 * expressed it in the payload rather than in words, which is exactly the signal
 * worth keeping.
 *
 * Memory-type proposals are excluded because they already ARE memories.
 */
export function shouldCapture(proposal: CapturableProposal): boolean {
  if (proposal.target_type !== 'work_item') return false
  const hasRationale = (proposal.rationale ?? '').trim().length > 0
  const wasEdited = proposal.edited_payload != null
  return hasRationale || wasEdited
}

/** Render an absent value as something readable rather than `null`/`undefined`. */
function display(value: unknown): string {
  if (value === null || value === undefined) return '(none)'
  if (Array.isArray(value)) return value.length === 0 ? '(empty)' : value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Render the field-level change from the undo envelope the accept already built,
 * as `field: before -> after`, sorted for a stable, diffable record.
 *
 * This reuses the pre-image captured for undo, so the most valuable content in
 * the memory is free for updates. A create has no pre-image and yields nothing.
 */
export function summarizeChange(appliedWrite: unknown): string[] {
  if (appliedWrite === null || typeof appliedWrite !== 'object') return []
  const envelope = (appliedWrite as Record<string, unknown>)[UNDO_KEY]
  if (envelope === null || typeof envelope !== 'object') return []

  const { pre_image: before, applied: after } = envelope as {
    pre_image?: Record<string, unknown>
    applied?: Record<string, unknown>
  }
  if (!before || !after) return []

  return Object.keys(after)
    .sort()
    .map((field) => `${field}: ${display(before[field])} -> ${display(after[field])}`)
}

/** The changed field names — a cheap, deterministic topic axis. */
function changedFields(appliedWrite: unknown): string[] {
  return summarizeChange(appliedWrite).map((line) => line.slice(0, line.indexOf(':')))
}

/** First sentence of the rationale, bounded. Falls back to the whole string. */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1)
  return sentence.length > TITLE_LIMIT ? `${sentence.slice(0, TITLE_LIMIT - 1)}…` : sentence
}

/**
 * Build the memory an accepted work-item proposal should leave behind, or `null`
 * when this accept is not worth remembering.
 *
 * `kind` is always `decision`. Never `fact` — an accept records that a choice was
 * made, not that the world is a certain way. Never `rule` — minting policy from a
 * single click is how a memory layer starts giving confidently wrong advice;
 * rules are the reflection layer's output, over many observations.
 */
export function buildCaptureInput(
  proposal: CapturableProposal,
  result: { readonly id: string; readonly title?: string | null },
  appliedWrite: unknown,
  approverUserId: string,
): CreateMemoryInput | null {
  if (!shouldCapture(proposal)) return null

  const changes = summarizeChange(appliedWrite)
  const fields = changedFields(appliedWrite)
  const itemLabel = result.title ? `"${result.title}"` : 'the work item'
  const rationale = (proposal.rationale ?? '').trim()
  const wasEdited = proposal.edited_payload != null

  const fallbackTitle =
    proposal.operation === 'create'
      ? `Created ${itemLabel}`
      : fields.length > 0
        ? `Changed ${fields.join(', ')} on ${itemLabel}`
        : `Updated ${itemLabel}`

  const body = [
    rationale,
    changes.length > 0 ? `Change:\n${changes.map((line) => `- ${line}`).join('\n')}` : '',
    wasEdited ? 'The reviewer edited this proposal before accepting it.' : '',
  ]
    .filter((section) => section.length > 0)
    .join('\n\n')

  return {
    kind: 'decision',
    title: rationale.length > 0 ? firstSentence(rationale) : fallbackTitle,
    body,
    // Scope to the item the decision was about. A create has no target_id until
    // the row exists, so fall back to what we just wrote.
    scopeType: 'work_item',
    scopeId: proposal.target_id ?? result.id,
    topics: fields,
    // Same provenance shape the memory-proposal path already stamps: the run
    // authored it, a HUMAN decided it. Blurring those two is how an audit trail
    // stops being able to answer "who chose this".
    sourceKind: 'proposal',
    sourceRunId: proposal.run_id,
    sourceProposalId: proposal.id,
    decidedBy: approverUserId,
  }
}
