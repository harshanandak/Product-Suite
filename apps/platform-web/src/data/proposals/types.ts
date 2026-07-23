/**
 * Agent-proposal data-seam vocabulary (Agent Slice PR3).
 *
 * A {@link Proposal} is an agent's PENDING suggestion to create or update a work
 * item — the unit a human disposes of in the review inbox. It mirrors the real
 * PR1/PR2 backend shape exactly (`GET /api/agent/proposals`): the adapter never
 * reshapes it, so the UI reasons about precisely what `accept` will apply.
 */

/**
 * Where a proposal ORIGINATED — the Review Inbox's source facet filters on it.
 * `chat` (a user asked an agent in the chat panel), `autonomous` (an unattended
 * agent run), or `connector` (an external integration). The backend may omit or
 * send an unknown value, so `Proposal.source` is nullable (missing/unknown ⇒ null).
 */
export type ProposalSource = "chat" | "autonomous" | "connector";

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
  /**
   * Where the proposal came from (drives the inbox source facet). Optional and
   * nullable: the backend may omit it entirely or send an unrecognized value —
   * both read as "no known source" (shown only under the All facet).
   */
  readonly source?: ProposalSource | null;
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
 * TODO(contracts-swap): Lane C now merges BEFORE Lane A, so this LOCAL mirror is
 * the source of truth at merge time. It is structurally identical to Lane A's
 * LOCKED envelope, so runtime is correct today. Once Lane A lands `AcceptResult`
 * in `@product-suite/contracts`, DELETE this local definition and
 * `import type { AcceptResult } from "@product-suite/contracts"` (same package the
 * app already imports `WorkItem`/`Team`/`Status` from) — an import-only swap.
 * The team lead is filing the follow-up to do that swap after Lane A merges.
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

/**
 * The result of {@link ProposalRepository.undo} — reversing an accepted change.
 * Surfaced, not thrown, exactly like {@link AcceptResult}, because every non-success
 * case here is something the reviewer must READ, not a crash:
 *  - `undone`       — the previous values were written back; `item_id` links to the item.
 *  - `conflict`     — the item moved since the accept (or the change was already
 *                     undone). NOTHING was written; `fields` names what drifted so the
 *                     banner can say *what* changed instead of a bare "conflict".
 *  - `not_undoable` — structurally irreversible here (a create, a memory op, or an
 *                     accept made before previous values were recorded).
 *  - `not_found`    — the proposal or its target item is gone.
 * A genuine transport/network error still throws (it is not an undo RESULT).
 */
export type UndoResult =
  | { readonly status: "undone"; readonly proposal_id: string; readonly item_id: string }
  | {
      readonly status: "conflict";
      readonly proposal_id: string;
      /** A plain-language explanation of what changed (never raw error text). */
      readonly message: string;
      /** The fields a later edit moved; empty for a status/race conflict. */
      readonly fields: readonly string[];
    }
  | {
      readonly status: "not_undoable";
      readonly proposal_id: string;
      /** A plain-language reason this change cannot be reversed. */
      readonly message: string;
    }
  | { readonly status: "not_found"; readonly proposal_id: string };
