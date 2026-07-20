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
 * A single field-level validation error carried by an `invalid` accept outcome
 * (Lane A's `field_errors[]`). `field` names the offending payload key; `message`
 * is ALREADY plain-language and safe to show a human (never a stack trace) — the
 * "Needs attention" banner renders it verbatim.
 */
export interface AcceptFieldError {
  readonly field: string;
  readonly message: string;
}

/**
 * The outcome of {@link ProposalRepository.accept}, SURFACED rather than thrown so
 * the detail view can react precisely instead of catching an opaque error:
 *  - `applied` — the backend applied it and returned the created/updated item.
 *  - `stale` — the underlying item changed since the proposal (409) or is gone
 *    (404); carries current-vs-proposed version context for the reconcile UI.
 *  - `invalid` — the payload failed server validation (422); carries per-field,
 *    plain-language reasons so the human sees WHY, never a raw error.
 *  - `failed` — the apply was rejected for a stated `reason` and may be
 *    `retryable`; the proposal stays pending so the human can retry/edit/discard.
 * A genuine transport/network error still throws (it is not an accept OUTCOME).
 *
 * TODO(lane-A-rebase): this is Lane C's LOCAL mirror of Lane A's pinned accept
 * envelope. Once Lane A merges, swap this definition for its exported
 * `AcceptResult` import (`@product-suite/contracts` or the API package). Lane A's
 * shape discriminates on `status` (not `outcome`) and is snake_case:
 *   applied → { status:'applied', proposal_id, item_id }
 *   invalid → { status:'invalid', proposal_id, field_errors:[{field,message}] }
 *   stale   → { status:'stale', proposal_id, item_id, current_version, proposed_version }
 *   failed  → { status:'failed', proposal_id, reason, retryable }
 * The network adapter is the single translation point (status/snake_case →
 * outcome/camelCase); the UI already consumes this camelCase surface, so only the
 * adapter + this type change on rebase. Keep `applied.item` (the UI links to
 * `item.id`); map Lane A's `item_id` through the adapter.
 */
export type AcceptResult =
  | { readonly outcome: "applied"; readonly item: WorkItem }
  | {
      readonly outcome: "stale";
      /** The item's CURRENT version — what a Refresh would re-base onto. */
      readonly currentVersion?: number | null;
      /** The version the agent's proposal was generated against. */
      readonly proposedVersion?: number | null;
    }
  | {
      readonly outcome: "invalid";
      /** Per-field, plain-language reasons; empty/absent ⇒ a generic message. */
      readonly fieldErrors?: readonly AcceptFieldError[];
    }
  | {
      readonly outcome: "failed";
      /** A plain-language reason for the failure (never raw error text). */
      readonly reason: string;
      /** Whether an unchanged retry could plausibly succeed (drives the Retry action). */
      readonly retryable: boolean;
    };
