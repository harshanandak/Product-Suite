/**
 * Agent-proposal data-seam vocabulary (Agent Slice PR3).
 *
 * A {@link Proposal} is an agent's PENDING suggestion to create or update a work
 * item — the unit a human disposes of in the review inbox. It mirrors the real
 * PR1/PR2 backend shape exactly (`GET /api/agent/proposals`): the adapter never
 * reshapes it, so the UI reasons about precisely what `accept` will apply.
 */

/**
 * A pending agent proposal (tenant-scoped). `operation` decides how `payload` is
 * read: a `create` payload is the full new item's fields; an `update` payload is
 * the CHANGED fields to merge onto the existing `target_id` item. `target_id` is
 * `null` for a create (nothing exists yet) and set for an update.
 */
export interface Proposal {
  readonly id: string;
  /**
   * What the proposal writes to. `work_item` patches the workboard; `memory`
   * (P1b) logs/changes an organizational memory (a decision/fact/rule) — both
   * disposed of in the same Review Inbox.
   */
  readonly target_type: "work_item" | "memory";
  /** The item/memory a non-create op targets; `null` for a `create`. */
  readonly target_id: string | null;
  /**
   * How `accept` applies the payload. `work_item`: `create` | `update`.
   * `memory`: `create` | `supersede` | `retract` | `defer`.
   */
  readonly operation: "create" | "update" | "supersede" | "retract" | "defer";
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
 * The result of {@link ProposalRepository.accept}, SURFACED rather than thrown so
 * the UI can react precisely instead of catching an opaque error. This is Lane
 * C's LOCAL MIRROR of Lane A's LOCKED accept envelope — discriminated on
 * `status`, snake_case, and ALWAYS carried in the JSON response body (the adapter
 * reads `status` from the body, never the HTTP code):
 *  - `applied`     — the write landed; `item_id` links to the created/updated item.
 *  - `invalid`     — payload failed server validation; `message` is plain-language;
 *                    `retryable` says whether an unchanged retry could plausibly succeed.
 *  - `stale`       — the item changed since the proposal; `item_id` is the target and
 *                    `message` explains the conflict (no version numbers in the envelope).
 *  - `failed`      — rejected for a stated `message`; `retryable` drives the Retry action.
 *  - `not_found`   — the proposal no longer exists.
 *  - `not_pending` — already handled (accepted/rejected elsewhere).
 * A genuine transport/network error still throws (it is not an accept RESULT).
 *
 * TODO(lane-A-rebase): once Lane A merges, DELETE this local definition and
 * `import type { AcceptResult } from "@product-suite/contracts"` (same package the
 * app already imports `WorkItem`/`Team`/`Status` from). This mirror matches Lane A's
 * LOCKED envelope EXACTLY, so the swap is import-only.
 */
export type AcceptResult =
  | { readonly status: "applied"; readonly proposal_id: string; readonly item_id: string }
  | {
      readonly status: "invalid";
      readonly proposal_id: string;
      /** A plain-language reason the payload failed validation (never raw error text). */
      readonly message: string;
      /** Whether re-submitting unchanged could plausibly succeed (drives Retry). */
      readonly retryable: boolean;
    }
  | {
      readonly status: "stale";
      readonly proposal_id: string;
      readonly item_id: string;
      /** A plain-language explanation of what changed (never raw error text). */
      readonly message: string;
    }
  | {
      readonly status: "failed";
      readonly proposal_id: string;
      /** A plain-language reason for the failure (never raw error text). */
      readonly message: string;
      /** Whether an unchanged retry could plausibly succeed (drives the Retry action). */
      readonly retryable: boolean;
    }
  | { readonly status: "not_found"; readonly proposal_id: string }
  | { readonly status: "not_pending"; readonly proposal_id: string };
