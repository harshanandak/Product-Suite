/**
 * Agent-proposal data-seam vocabulary (Agent Slice PR3).
 *
 * A {@link Proposal} is an agent's PENDING suggestion to create or update a work
 * item — the unit a human disposes of in the review inbox. It mirrors the real
 * PR1/PR2 backend shape exactly (`GET /api/agent/proposals`): the adapter never
 * reshapes it, so the UI reasons about precisely what `accept` will apply.
 */
import type { WorkItem } from "@/data/work-items";

/**
 * A pending agent proposal (tenant-scoped). `operation` decides how `payload` is
 * read: a `create` payload is the full new item's fields; an `update` payload is
 * the CHANGED fields to merge onto the existing `target_id` item. `target_id` is
 * `null` for a create (nothing exists yet) and set for an update.
 */
export interface Proposal {
  readonly id: string;
  /** Only work items are proposable today. */
  readonly target_type: "work_item";
  /** The item an `update` targets; `null` for a `create`. */
  readonly target_id: string | null;
  /** Whether accepting creates a new item or patches `target_id`. */
  readonly operation: "create" | "update";
  /**
   * The fields `accept` applies — a full item for `create`, the changed fields
   * for `update`. Deliberately `Record<string, unknown>`: the backend owns the
   * exact key set, and the detail view renders whatever is present as rows.
   */
  readonly payload: Record<string, unknown>;
  /** The agent's reasoning for this proposal; `null` when it gave none. */
  readonly rationale: string | null;
  /** Model self-confidence in `[0,1]`; `null` when unscored. */
  readonly confidence: number | null;
  /** Lifecycle status; the inbox lists only pending ones. */
  readonly status: string;
  /** The agent run that emitted this proposal (provenance). */
  readonly run_id: string;
  /** The model that authored this proposal (provenance). */
  readonly model_id: string;
  readonly created_at: string;
}

/**
 * The outcome of {@link ProposalRepository.accept}, SURFACED rather than thrown so
 * the detail view can react precisely instead of catching an opaque error:
 *  - `applied` — the backend applied it and returned the created/updated item.
 *  - `stale` — no longer pending (HTTP 409) or gone (404); the list must refetch.
 *  - `invalid` — the payload failed server validation (422).
 * A genuine transport/5xx error still throws (it is not an accept OUTCOME).
 */
export type AcceptResult =
  | { readonly outcome: "applied"; readonly item: WorkItem }
  | { readonly outcome: "stale" }
  | { readonly outcome: "invalid" };
