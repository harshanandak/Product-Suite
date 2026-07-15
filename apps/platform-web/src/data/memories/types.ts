/**
 * Memory-brain data-seam vocabulary (Memory Brain P1).
 *
 * A {@link MemoryRow} is a durable organizational memory — a decision, fact, or
 * rule — that the Decision Log surfaces and a human captures via "Log a
 * decision". It mirrors the real backend shape exactly (`GET /api/memories`):
 * the adapter never reshapes it, so the UI reasons about precisely what the
 * server stores. All fields are snake_case, matching the JSON on the wire.
 */

/** What a memory IS. In P1 humans create only `decision`/`fact` (`rule` is P2). */
export type MemoryKind = "decision" | "fact" | "rule";

/** Lifecycle status. Only `active` memories are "current" (Topic view). */
export type MemoryStatus = "active" | "superseded" | "retracted" | "deferred";

/** The scope a memory is anchored to (a tenant-boundary narrowing). */
export type ScopeType = "org" | "project" | "work_item_type" | "work_item";

/** Where a memory came from (provenance; groups the Decision Log). */
export type SourceKind = "meeting" | "chat" | "proposal" | "manual" | "import";

/**
 * A single memory row (tenant-scoped), mirroring the backend JSON exactly. The
 * supersession chain is expressed through `root_id`/`supersedes_id`/
 * `superseded_by_id`: an edit RETRACTS nothing — it appends a new active row
 * pointing back at the one it replaces, so history is never lost.
 */
export interface MemoryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body: string | null;
  readonly attrs: Record<string, unknown> | null;
  /** The first version's id — every version in a chain shares one `root_id`. */
  readonly root_id: string | null;
  /** The version this one replaced; `null` for the original. */
  readonly supersedes_id: string | null;
  /** The version that replaced this one; `null` while still current. */
  readonly superseded_by_id: string | null;
  /** Why this version replaced its predecessor (set on the newer row). */
  readonly change_reason: string | null;
  readonly valid_from: string | null;
  readonly status: MemoryStatus;
  /** For a deferred memory: what it is blocked on. */
  readonly waiting_on: string | null;
  /** For a deferred memory: revisit-after timestamp. */
  readonly review_after: string | null;
  readonly scope_type: ScopeType;
  readonly scope_id: string | null;
  readonly topics: string[];
  readonly source_kind: SourceKind;
  readonly source_run_id: string | null;
  readonly source_proposal_id: string | null;
  readonly source_quote: string | null;
  readonly created_by: string | null;
  readonly decided_by: string | null;
  readonly pinned: boolean;
  readonly priority: number | null;
  readonly enforcement: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A memory plus its full supersession history (`GET /api/memories/:id`). The
 * chain is every version sharing this row's `root_id`, oldest first — so a
 * superseded row can render "replaced by … because …" without extra fetches.
 */
export interface MemoryDetail {
  readonly memory: MemoryRow;
  /** Full supersession history, oldest first. */
  readonly chain: MemoryRow[];
}

/** List filters for `GET /api/memories` (all optional; omitted ⇒ unfiltered). */
export interface MemoryFilters {
  readonly kind?: MemoryKind;
  readonly status?: MemoryStatus;
  readonly topic?: string;
  readonly scope_type?: ScopeType;
  readonly scope_id?: string;
  /** Free-text search across title/body. */
  readonly q?: string;
}

/**
 * Body for `POST /api/memories` — the "Log a decision" capture. `title` is the
 * only required field; the memory is `active` IMMEDIATELY (no review step).
 * `org_id` is injected by the adapter from the active org, never by the form.
 */
export interface CreateMemoryInput {
  readonly kind: MemoryKind;
  readonly title: string;
  readonly body?: string;
  readonly topics?: string[];
  readonly scopeType?: ScopeType;
  readonly scopeId?: string;
  readonly sourceKind?: SourceKind;
  readonly decidedBy?: string;
}

/**
 * Body for `POST /api/memories/:id/supersede`. `change_reason` is REQUIRED —
 * the backend 400s without it and the form blocks submit — because a memory's
 * value is its accountable history: an unexplained replacement is a lie.
 */
export interface SupersedeMemoryInput {
  readonly title?: string;
  readonly body?: string;
  readonly topics?: string[];
  readonly change_reason: string;
}

/** Body for `POST /api/memories/:id/defer` (both fields optional). */
export interface DeferMemoryInput {
  readonly waiting_on?: string;
  readonly review_after?: string;
}
