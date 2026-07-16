import type { MemoryRow } from "@/data/memories";
import type { Proposal } from "@/data/proposals";

/**
 * Rendering helpers for a `target_type='memory'` proposal in the Review Inbox
 * (Memory Brain P1b). A memory proposal is the agent proposing to LOG or CHANGE
 * an organizational memory; the human disposes of it through the same Accept /
 * Reject as a work-item proposal. These functions are pure so the surface they
 * feed is fully testable — the decision of WHAT `accept` applies must be exact.
 */

/** The memory payload shapes, read defensively (the backend owns the key set). */
type MemoryPayload = Record<string, unknown>;

/** A read of `payload[key]` as a trimmed non-empty string, else undefined. */
function str(payload: MemoryPayload, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Human label for a memory kind (falls back to the raw value). */
function kindNoun(kind: unknown): string {
  if (kind === "decision") return "decision";
  if (kind === "fact") return "fact";
  if (kind === "rule") return "rule";
  return "memory";
}

/** The title a supersede/retract/defer target shows — the fetched memory's, else the id. */
function targetName(proposal: Proposal, target: MemoryRow | undefined): string {
  return target?.title ?? proposal.target_id ?? "memory";
}

/**
 * The top-line operation sentence:
 *  - create    → `Log a decision: "<title>"` (noun per kind).
 *  - supersede → `Supersede <target>: <n> change(s)`.
 *  - retract   → `Retract "<target>"`.
 *  - defer     → `Defer "<target>"`.
 */
export function describeMemoryOperation(
  proposal: Proposal,
  target: MemoryRow | undefined,
  changedCount: number,
): string {
  const payload = proposal.payload as MemoryPayload;
  if (proposal.operation === "create") {
    const title = str(payload, "title") ?? "Untitled memory";
    return `Log a ${kindNoun(payload.kind)}: “${title}”`;
  }
  if (proposal.operation === "supersede") {
    const unit = changedCount === 1 ? "change" : "changes";
    return `Supersede ${targetName(proposal, target)}: ${changedCount} ${unit}`;
  }
  if (proposal.operation === "retract") {
    return `Retract “${targetName(proposal, target)}”`;
  }
  return `Defer “${targetName(proposal, target)}”`;
}

/** One labelled attribute row on the memory decision surface. */
export interface MemoryFieldRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The attribute rows for a memory CREATE — kind, topics, and scope (the body is
 * rendered separately as the primary surface, not a row). Absent fields are
 * omitted rather than shown empty.
 */
export function buildMemoryCreateRows(proposal: Proposal): MemoryFieldRow[] {
  const payload = proposal.payload as MemoryPayload;
  const rows: MemoryFieldRow[] = [];
  rows.push({ label: "kind", value: kindNoun(payload.kind) });
  const topics = payload.topics;
  if (Array.isArray(topics) && topics.length > 0) {
    rows.push({ label: "topics", value: topics.map((t) => String(t)).join(", ") });
  }
  const scopeType = str(payload, "scope_type");
  if (scopeType) {
    const scopeId = str(payload, "scope_id");
    rows.push({ label: "scope", value: scopeId ? `${scopeType} · ${scopeId}` : scopeType });
  }
  return rows;
}

/** A current → proposed change on a supersede (only fields the supersede overrides). */
export interface MemoryChangeRow {
  readonly field: string;
  readonly current: string;
  readonly proposed: string;
}

/**
 * The supersede diff — for each of `title`/`body`/`topics` the proposal overrides,
 * a `current → proposed` row (current from the fetched target, em-dash when the
 * target is still loading / not found so the reviewer never sees a blank diff).
 */
export function buildMemorySupersedeRows(
  proposal: Proposal,
  target: MemoryRow | undefined,
): MemoryChangeRow[] {
  const payload = proposal.payload as MemoryPayload;
  const rows: MemoryChangeRow[] = [];
  const emdash = "—";

  const proposedTitle = str(payload, "title");
  if (proposedTitle !== undefined) {
    rows.push({ field: "title", current: target?.title ?? emdash, proposed: proposedTitle });
  }
  const proposedBody = str(payload, "body");
  if (proposedBody !== undefined) {
    rows.push({
      field: "body",
      current: (target?.body ?? "").trim() || emdash,
      proposed: proposedBody,
    });
  }
  const proposedTopics = payload.topics;
  if (Array.isArray(proposedTopics)) {
    const current = target?.topics?.length ? target.topics.join(", ") : emdash;
    rows.push({
      field: "topics",
      current,
      proposed: proposedTopics.length > 0 ? proposedTopics.map((t) => String(t)).join(", ") : "(none)",
    });
  }
  return rows;
}

/** The mandatory change_reason on a supersede (null for other operations). */
export function memoryChangeReason(proposal: Proposal): string | null {
  if (proposal.operation !== "supersede") return null;
  return str(proposal.payload as MemoryPayload, "change_reason") ?? null;
}

/** The primary body/rationale text of a create/supersede memory proposal (or null). */
export function memoryBody(proposal: Proposal): string | null {
  return str(proposal.payload as MemoryPayload, "body") ?? null;
}

/** Defer context (waiting_on / review_after) as attribute rows. */
export function buildMemoryDeferRows(proposal: Proposal): MemoryFieldRow[] {
  const payload = proposal.payload as MemoryPayload;
  const rows: MemoryFieldRow[] = [];
  const waitingOn = str(payload, "waiting_on");
  if (waitingOn) rows.push({ label: "waiting on", value: waitingOn });
  const reviewAfter = str(payload, "review_after");
  if (reviewAfter) rows.push({ label: "review after", value: reviewAfter });
  return rows;
}

/** Short list label for a memory proposal (no target fetch available in the list). */
export function memoryListTitle(proposal: Proposal): string {
  const payload = proposal.payload as MemoryPayload;
  if (proposal.operation === "create") {
    return str(payload, "title") ?? "Untitled memory";
  }
  const verb =
    proposal.operation === "supersede"
      ? "Supersede"
      : proposal.operation === "retract"
        ? "Retract"
        : "Defer";
  return proposal.target_id ? `${verb} ${proposal.target_id}` : `${verb} memory`;
}
