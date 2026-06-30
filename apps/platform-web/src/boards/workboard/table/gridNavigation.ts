/**
 * Pure cell-coordinate math for the {@link WorkboardTable}'s ARIA-grid keyboard
 * navigation (roving tabindex — https://www.w3.org/WAI/ARIA/apg/patterns/grid/).
 *
 * The table is VIRTUALIZED, so an "active cell" can never be a DOM reference or a
 * raw index — it must be a STABLE coordinate that survives scroll / reorder /
 * regroup. We mirror the selection anchor's strategy (which stores a row ID, not
 * an index): the active cell is `{ rowKey, colIndex }` where `rowKey` is the flat
 * row's stable key (`item:<id>` / `group:<label>`) re-resolved against the LIVE
 * flat list at navigation time, and `colIndex` is the 1-based `aria-colindex`.
 *
 * Keeping this logic pure (no React, no DOM) lets the index/clamp/group-row rules
 * be unit-tested deterministically — the parts jsdom's missing layout engine
 * can't exercise — while the component layer only wires events + focus.
 */

/** A flat row's identity + kind, the minimum the navigation math needs. */
export interface NavRow {
  /** `"group"` swimlane headers expose only column 1; `"item"` rows, all. */
  readonly kind: "group" | "item";
  /** Stable key (`item:<id>` / `group:<label>`) — survives scroll/reorder. */
  readonly key: string;
}

/** A cell coordinate: a stable row key + its 1-based `aria-colindex`. */
export interface CellCoord {
  readonly rowKey: string;
  readonly colIndex: number;
}

/** A single keyboard navigation intent, decoded from the raw key event. */
export type NavCommand =
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "gridHome"
  | "gridEnd";

/** Ctrl/Meta modifier state read off the key event (Meta = ⌘ on macOS). */
export interface KeyModifiers {
  readonly ctrl: boolean;
  readonly meta: boolean;
}

/**
 * The max navigable 1-based `colIndex` for a row. Swimlane GROUP headers render
 * a single (col-spanning) gridcell — its select-all checkbox — so only column 1
 * is navigable there; ITEM rows expose every column up to `colCount` (selection
 * + data columns + the optional actions column).
 */
function maxColForRow(row: NavRow, colCount: number): number {
  return row.kind === "group" ? 1 : colCount;
}

/** Clamp a `colIndex` into a row's navigable range (group rows collapse to 1). */
function clampCol(row: NavRow, colIndex: number, colCount: number): number {
  const max = maxColForRow(row, colCount);
  if (colIndex < 1) return 1;
  if (colIndex > max) return max;
  return colIndex;
}

/**
 * Compute the next active cell for a navigation command. Pure: given the live
 * flat rows, the grid's column count, and the current coordinate, returns the
 * next coordinate with all clamping + group-row rules applied.
 *
 * - Horizontal (`left`/`right`/`home`/`end`) stays on the current row.
 * - Vertical (`up`/`down`) moves one row, carrying the column but clamping it
 *   into the destination row's range — so dropping onto a GROUP header lands on
 *   its col-1 select-all checkbox regardless of the source column.
 * - `gridHome`/`gridEnd` jump to the very first / last navigable cell.
 *
 * A stale `current.rowKey` (its row filtered out) re-resolves to the first row
 * before moving, so navigation can never throw on a vanished coordinate.
 */
export function computeNextCell(
  rows: readonly NavRow[],
  colCount: number,
  current: CellCoord,
  command: NavCommand,
): CellCoord {
  if (rows.length === 0) return current;

  let index = rows.findIndex((row) => row.key === current.rowKey);
  if (index < 0) index = 0;
  const row = rows[index];
  const col = clampCol(row, current.colIndex, colCount);

  switch (command) {
    case "left":
      return { rowKey: row.key, colIndex: Math.max(1, col - 1) };
    case "right":
      return { rowKey: row.key, colIndex: clampCol(row, col + 1, colCount) };
    case "home":
      return { rowKey: row.key, colIndex: 1 };
    case "end":
      return { rowKey: row.key, colIndex: maxColForRow(row, colCount) };
    case "up": {
      const target = rows[Math.max(0, index - 1)];
      return { rowKey: target.key, colIndex: clampCol(target, col, colCount) };
    }
    case "down": {
      const target = rows[Math.min(rows.length - 1, index + 1)];
      return { rowKey: target.key, colIndex: clampCol(target, col, colCount) };
    }
    case "gridHome": {
      const target = rows[0];
      return { rowKey: target.key, colIndex: 1 };
    }
    case "gridEnd": {
      const target = rows[rows.length - 1];
      return { rowKey: target.key, colIndex: maxColForRow(target, colCount) };
    }
    default:
      return current;
  }
}

/**
 * Resolve the stored active coordinate against the LIVE flat rows so the grid
 * always has exactly one tabbable cell. Returns `null` only for an empty grid;
 * otherwise an unset / vanished key falls back to the first row's first column,
 * and a surviving key keeps its (clamped) column.
 */
export function resolveActiveCell(
  rows: readonly NavRow[],
  active: CellCoord | null,
  colCount: number,
): CellCoord | null {
  if (rows.length === 0) return null;
  if (active !== null) {
    const row = rows.find((candidate) => candidate.key === active.rowKey);
    if (row !== undefined) {
      return { rowKey: row.key, colIndex: clampCol(row, active.colIndex, colCount) };
    }
  }
  return { rowKey: rows[0].key, colIndex: 1 };
}

/**
 * Decode a raw key + modifier state into a {@link NavCommand}, or `null` when the
 * key isn't a grid-navigation key (so the caller leaves the event alone). Home /
 * End escalate to whole-grid jumps under Ctrl (or ⌘ Meta on macOS).
 */
export function commandForKey(
  key: string,
  mod: KeyModifiers,
): NavCommand | null {
  const gridJump = mod.ctrl || mod.meta;
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return gridJump ? "gridHome" : "home";
    case "End":
      return gridJump ? "gridEnd" : "end";
    default:
      return null;
  }
}
