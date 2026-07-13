import type { Proposal } from "@/data/proposals";
import type { WorkItem } from "@/data/work-items";

/**
 * One row of the proposal field table — the decision surface's core. For a
 * `create` only `proposed` is set; for an `update` both `current` and `proposed`
 * are set and the row is included ONLY when they differ (the diff shows exactly
 * what `accept` will change — a wrong diff destroys trust, so this is the most
 * carefully-tested unit in the slice).
 */
export interface FieldRow {
  /** The payload key (e.g. `priority`, `title`). */
  field: string;
  /** The target's current value, formatted; `undefined` for a `create`. */
  current?: string;
  /** The proposed value `accept` will apply, formatted. */
  proposed: string;
}

/** Format an unknown payload/work-item value for display. Never throws. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 0 ? value : "—";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatValue).join(", ") : "—";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Structural equality via canonical JSON (order-sensitive), normalizing nullish. */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined ? null : v);
  try {
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  } catch {
    return norm(a) === norm(b);
  }
}

/**
 * The field rows for a proposal — the faithful representation of what `accept`
 * applies:
 *  - `create`: every provided payload field as `field | value`.
 *  - `update`: `field | current → proposed` for the payload fields that actually
 *    CHANGE. When `target` is not yet known (still loading / not found) every
 *    payload field is shown with an em-dash current, so the reviewer never sees a
 *    silently empty diff.
 */
export function buildFieldRows(
  proposal: Proposal,
  target: WorkItem | undefined,
): FieldRow[] {
  const entries = Object.entries(proposal.payload);

  if (proposal.operation === "create") {
    return entries.map(([field, value]) => ({
      field,
      proposed: formatValue(value),
    }));
  }

  // update
  const targetRecord = target as Record<string, unknown> | undefined;
  const rows: FieldRow[] = [];
  for (const [field, proposed] of entries) {
    const current = targetRecord?.[field];
    // With a known target, hide fields the update does not actually change.
    if (targetRecord !== undefined && sameValue(current, proposed)) continue;
    rows.push({
      field,
      current: formatValue(current),
      proposed: formatValue(proposed),
    });
  }
  return rows;
}

/**
 * The top-line operation sentence:
 *  - `create` → `Create work item "<title>"`.
 *  - `update` → `Update <target title>: <n> field(s)` (n = changed row count).
 */
export function describeOperation(
  proposal: Proposal,
  target: WorkItem | undefined,
  changedCount: number,
): string {
  if (proposal.operation === "create") {
    const title = proposal.payload.title;
    const name =
      typeof title === "string" && title.length > 0
        ? title
        : "Untitled work item";
    return `Create work item “${name}”`;
  }
  const targetName =
    target?.title ?? proposal.target_id ?? "work item";
  const unit = changedCount === 1 ? "field" : "fields";
  return `Update ${targetName}: ${changedCount} ${unit}`;
}

/** Short label for a proposal in the list (no target fetch available there). */
export function proposalListTitle(proposal: Proposal): string {
  if (proposal.operation === "create") {
    const title = proposal.payload.title;
    return typeof title === "string" && title.length > 0
      ? title
      : "Untitled work item";
  }
  return proposal.target_id
    ? `Update ${proposal.target_id}`
    : "Update work item";
}

/** A muted numeric confidence label, or `null` when unscored (badge hidden). */
export function formatConfidence(confidence: number | null): string | null {
  if (confidence === null) return null;
  return confidence.toFixed(2);
}

/** Compact created-at label (e.g. `Jul 13, 09:12`); falls back to the raw string. */
export function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
