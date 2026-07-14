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

/**
 * Format an unknown payload/work-item value for display. Never throws. The
 * "empty" kinds render DISTINGUISHABLY — `undefined`/absent as an em-dash,
 * `null` as `null`, `""` as `(empty)`, `[]` as `(none)` — so a genuine change
 * between two empties (e.g. `"" → null`) never collapses into `— → —`, which
 * would look unchanged and silently hide a real edit.
 */
export function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 0 ? value : "(empty)";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatValue).join(", ") : "(none)";
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Unstringifiable (e.g. circular) — a stable label beats "[object Object]".
    return "[unserializable value]";
  }
}

/**
 * Recursively normalize a value for structural comparison: nullish collapses to
 * `null`, and plain-object keys are SORTED so a reordered-but-equal object
 * compares equal. Array order is preserved (element order is meaningful).
 */
function normalizeForCompare(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  // Explicit locale compare (not the default sort) so key ordering is stable and
  // reliable for the canonical-JSON equality below.
  for (const key of Object.keys(record).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = normalizeForCompare(record[key]);
  }
  return sorted;
}

/** Structural equality via canonical JSON, KEY-ORDER-INSENSITIVE for objects. */
function sameValue(a: unknown, b: unknown): boolean {
  try {
    return (
      JSON.stringify(normalizeForCompare(a)) ===
      JSON.stringify(normalizeForCompare(b))
    );
  } catch {
    const norm = (v: unknown) => (v === undefined ? null : v);
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
