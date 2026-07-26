/**
 * The work-item field vocabulary shared by every part of the proposal lifecycle —
 * DRAFT (snapshot the target's authored-against values), ACCEPT (fence the write on
 * them, capture the pre-image) and UNDO (restore it). A leaf module on purpose: it
 * imports nothing from the proposal modules, so `repository.ts`, `apply.ts` and
 * `undo.ts` can all share it without an import cycle.
 */

/**
 * The work-item columns a proposal payload can set — and that an undo can therefore
 * restore (`WorkItemPatch`'s key set; see `@product-suite/contracts`). `depth` is
 * excluded deliberately: it is SERVER-derived from `parent_id`, never a caller patch,
 * so restoring `parent_id` restores it implicitly.
 */
export const UNDOABLE_FIELDS = [
  'title',
  'description',
  'phase',
  'type',
  'priority',
  'tags',
  'project_id',
  'team_id',
  'status_id',
  'parent_id',
  'department',
  'assignee_id',
  'due_date',
  'archived',
] as const

/**
 * Normalize a column value for STRUCTURAL comparison and for jsonb storage. A
 * `timestamptz` comes back as a `Date` from a live read but as an ISO string once
 * it has round-tripped through jsonb, so both sides collapse to the ISO string —
 * otherwise every undo of an item with a due date would false-conflict. `undefined`
 * becomes `null` because jsonb DROPS undefined keys, which would silently shrink
 * the pre-image.
 */
export function normalizeFieldValue(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeFieldValue)
  return value
}

/** The patch keys that are real, restorable columns (everything else is ignored). */
export function undoableKeys(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return []
  return UNDOABLE_FIELDS.filter((field) => field in (payload as Record<string, unknown>))
}

/** Read exactly `fields` off a row, normalized — an absent column records as `null`. */
export function fieldSnapshot(
  row: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const field of fields) snapshot[field] = normalizeFieldValue(row[field])
  return snapshot
}

/**
 * The fields where a row's CURRENT value no longer matches the values a decision was
 * made against — i.e. what somebody changed since. A non-empty list means the write
 * must refuse: proceeding would silently discard that later edit.
 */
export function conflictingFields(
  expected: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(expected).filter((field) => {
    const before = JSON.stringify(normalizeFieldValue(expected[field]) ?? null)
    const now = JSON.stringify(normalizeFieldValue(current[field]) ?? null)
    return before !== now
  })
}
