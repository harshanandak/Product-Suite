import * as React from "react";

import { COLUMN_IDS, type ColumnId } from "@/boards/workboard/filter-state";

/**
 * Resizable-column sizing state for the {@link WorkboardTable}.
 *
 * The data columns are sized by PX widths exposed as CSS custom properties on
 * the scroll container (`--col-<id>`), so the rendered cells read the live var
 * (`width: var(--col-<id>)`) and a drag can repaint by mutating the var with NO
 * React re-render. React state (`widths`) exists only to SEED those vars and to
 * persist a committed width — the cells never read the state directly.
 *
 * Persistence is per-column under `workboard.table.colw.v1.<columnId>`, read on
 * mount (guarded for SSR + privacy-mode throw, ignoring NaN / unknown ids) and
 * written only on a pointer-up or keyboard commit. {@link UseColumnWidthsResult.reset}
 * clears every key and restores the {@link ColumnWidthInput.width} defaults.
 */

/** localStorage key prefix; one versioned key per column. */
const STORAGE_PREFIX = "workboard.table.colw.v1.";
/** Pixels per rem for the rem→px seed conversion (browser/Tailwind default). */
const PX_PER_REM = 16;
/** Hard ceiling for any column width (px). */
export const MAX_COLUMN_WIDTH = 720;
/** Floor (px) for a column whose spec declares no explicit `minWidth`. */
const DEFAULT_MIN_WIDTH = 56;
/** Keyboard resize step (px) and its Shift-accelerated variant. */
const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
/** Padding (px) added to the measured content width on autofit (cell px-2 → 2×8). */
const AUTOFIT_PADDING = 16;

/**
 * The sizing contract the hook needs from a column. The table's full
 * `ColumnSpec` structurally satisfies it (id + rem `width` + optional rem
 * `minWidth`), so the visible specs can be passed straight through.
 */
export interface ColumnWidthInput {
  readonly id: ColumnId;
  /** Default width as a rem string (e.g. "16rem"); converted to px on seed. */
  readonly width: string;
  /** Optional floor as a rem string; defaults to {@link DEFAULT_MIN_WIDTH} px. */
  readonly minWidth?: string;
}

/** The value surface the table renders from. */
export interface UseColumnWidthsResult {
  /** Committed px width per visible column (seeds the CSS vars + persists). */
  readonly widths: Record<ColumnId, number>;
  /** Full table width in px: Σ visible column widths + the fixed `extraWidth`. */
  readonly tableWidth: number;
  /** Scroll-container style: every `--col-<id>` var plus `--table-width`. */
  readonly cssVars: React.CSSProperties;
  /** Ref for the scroll container that owns the vars (and the virtualizer root). */
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  /** A column's clamping floor (for the handle's `aria-valuemin`). */
  readonly minWidthOf: (id: ColumnId) => number;
  /** Begin a pointer drag from a column's resize handle. */
  readonly onPointerResizeStart: (
    id: ColumnId,
    event: React.PointerEvent,
  ) => void;
  /**
   * Keyboard resize: Arrow ±{@link KEY_STEP} (Shift ±{@link KEY_STEP_LARGE}),
   * Home = min, End = max, Enter / Space = autofit.
   */
  readonly onKeyResize: (id: ColumnId, event: React.KeyboardEvent) => void;
  /** Size a column to its widest mounted cell; falls back to its default. */
  readonly autofit: (id: ColumnId) => void;
  /** Clear every persisted key and restore all columns to their defaults. */
  readonly reset: () => void;
}

/** Parse a rem (or px / bare-number) length string into pixels. */
function remToPx(value: string): number {
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return 0;
  if (trimmed.endsWith("px")) return Math.round(numeric);
  return Math.round(numeric * PX_PER_REM);
}

/** The CSS custom-property name carrying a column's live width. */
function varName(id: ColumnId): string {
  return `--col-${id}`;
}

function clampWidth(width: number, min: number): number {
  return Math.min(Math.max(width, min), MAX_COLUMN_WIDTH);
}

/** A column's px floor from its (optional) rem `minWidth`. */
function minOf(column: ColumnWidthInput): number {
  return column.minWidth === undefined
    ? DEFAULT_MIN_WIDTH
    : remToPx(column.minWidth);
}

/** A column's default px width (its rem `width`, never below its floor). */
function defaultOf(column: ColumnWidthInput): number {
  return clampWidth(remToPx(column.width), minOf(column));
}

/** Read a persisted width, validated + clamped; null when absent / invalid. */
function readStored(id: ColumnId, min: number): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return clampWidth(parsed, min);
  } catch {
    return null;
  }
}

function writeStored(id: ColumnId, width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, String(width));
  } catch {
    /* ignore quota / privacy-mode throws — the width still lives in state */
  }
}

function removeStored(id: ColumnId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + id);
  } catch {
    /* ignore */
  }
}

/**
 * Manage resizable px column widths for the workboard table.
 *
 * @param columns - the VISIBLE column sizing inputs, in render order.
 * @param extraWidth - fixed px not covered by `columns` (the leading selection
 *   column + the trailing actions column), folded into {@link
 *   UseColumnWidthsResult.tableWidth}. Documented deviation from the spec's bare
 *   `useColumnWidths(columns)` signature so `--table-width` spans the whole row.
 */
export function useColumnWidths(
  columns: readonly ColumnWidthInput[],
  extraWidth = 0,
): UseColumnWidthsResult {
  // Stable per-column default + floor, derived once from the rem spec values.
  const sizing = React.useMemo(() => {
    const map = new Map<ColumnId, { readonly default: number; readonly min: number }>();
    for (const column of columns) {
      map.set(column.id, { default: defaultOf(column), min: minOf(column) });
    }
    return map;
  }, [columns]);

  const minWidthOf = React.useCallback(
    (id: ColumnId): number => sizing.get(id)?.min ?? DEFAULT_MIN_WIDTH,
    [sizing],
  );
  const defaultWidthOf = React.useCallback(
    (id: ColumnId): number => sizing.get(id)?.default ?? DEFAULT_MIN_WIDTH,
    [sizing],
  );

  // Committed widths. Seeded once from localStorage → default; the cells read
  // the CSS var, never this state — it only seeds the var and is what we persist.
  const [widths, setWidths] = React.useState<Record<ColumnId, number>>(() => {
    const seed = {} as Record<ColumnId, number>;
    for (const column of columns) {
      seed[column.id] = readStored(column.id, minOf(column)) ?? defaultOf(column);
    }
    return seed;
  });

  // Seed any newly-visible column not yet tracked (re-reads its persisted width).
  React.useEffect(() => {
    setWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const column of columns) {
        if (next[column.id] === undefined) {
          next[column.id] =
            readStored(column.id, minOf(column)) ?? defaultOf(column);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [columns]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // Live drag width held outside React state so a parent re-render mid-drag does
  // not snap the column back to its committed width before pointer-up commits.
  const dragRef = React.useRef<{
    readonly id: ColumnId;
    readonly width: number;
    readonly tableWidth: number;
  } | null>(null);

  const tableWidth =
    extraWidth +
    columns.reduce(
      (sum, column) => sum + (widths[column.id] ?? defaultWidthOf(column.id)),
      0,
    );

  const cssVars = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const column of columns) {
      vars[varName(column.id)] = `${
        widths[column.id] ?? defaultWidthOf(column.id)
      }px`;
    }
    vars["--table-width"] = `${tableWidth}px`;
    return vars as React.CSSProperties;
  }, [columns, widths, tableWidth, defaultWidthOf]);

  // Re-apply the live drag width after EVERY render while a drag is active: the
  // container's React `style` prop would otherwise rewrite the var back to the
  // committed value on an unrelated parent re-render (correction 3).
  React.useLayoutEffect(() => {
    const drag = dragRef.current;
    const container = containerRef.current;
    if (drag === null || container === null) return;
    container.style.setProperty(varName(drag.id), `${drag.width}px`);
    container.style.setProperty("--table-width", `${drag.tableWidth}px`);
  });

  const commit = React.useCallback((id: ColumnId, width: number): void => {
    setWidths((prev) => ({ ...prev, [id]: width }));
    writeStored(id, width);
  }, []);

  const autofit = React.useCallback(
    (id: ColumnId): void => {
      const container = containerRef.current;
      const min = minWidthOf(id);
      let measured = 0;
      if (container !== null) {
        const cells = Array.from(
          container.querySelectorAll<HTMLElement>(`[data-col-id="${id}"]`),
        );
        for (const cell of cells) {
          measured = Math.max(measured, cell.scrollWidth + AUTOFIT_PADDING);
        }
      }
      // No measurable content (jsdom / empty column) → restore the default.
      const next =
        measured > 0
          ? clampWidth(measured, min)
          : clampWidth(defaultWidthOf(id), min);
      commit(id, next);
    },
    [commit, defaultWidthOf, minWidthOf],
  );

  // Teardown for the in-flight drag, so an unmount mid-drag can detach the window
  // listeners + restore page chrome (a drag that never releases otherwise leaks
  // listeners and leaves document.body cursor:col-resize / userSelect:none).
  const activeTeardownRef = React.useRef<(() => void) | null>(null);

  const onPointerResizeStart = React.useCallback(
    (id: ColumnId, event: React.PointerEvent): void => {
      const container = containerRef.current;
      if (container === null) return;
      event.preventDefault();
      const min = minWidthOf(id);
      const startX = event.clientX;
      const startWidth = widths[id] ?? defaultWidthOf(id);
      const baseTableWidth = tableWidth - startWidth;
      let latest = startWidth;
      let frame = 0;

      try {
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      } catch {
        /* unsupported (jsdom) — the window listeners still drive the drag */
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: PointerEvent): void => {
        latest = clampWidth(startWidth + (moveEvent.clientX - startX), min);
        dragRef.current = {
          id,
          width: latest,
          tableWidth: baseTableWidth + latest,
        };
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const drag = dragRef.current;
          if (drag === null) return;
          container.style.setProperty(varName(id), `${drag.width}px`);
          container.style.setProperty("--table-width", `${drag.tableWidth}px`);
        });
      };

      const handleUp = (): void => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        if (frame !== 0) cancelAnimationFrame(frame);
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        activeTeardownRef.current = null;
        commit(id, latest);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      // A pointercancel (touch/pen interruption, or an OS gesture) never fires
      // pointerup, so route it through the same teardown.
      window.addEventListener("pointercancel", handleUp);
      // Unmounting mid-drag detaches the listeners + restores chrome (no commit —
      // the component is going away).
      activeTeardownRef.current = (): void => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        if (frame !== 0) cancelAnimationFrame(frame);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    },
    [commit, defaultWidthOf, minWidthOf, tableWidth, widths],
  );

  React.useEffect(
    () => () => {
      activeTeardownRef.current?.();
    },
    [],
  );

  const onKeyResize = React.useCallback(
    (id: ColumnId, event: React.KeyboardEvent): void => {
      const min = minWidthOf(id);
      const current = widths[id] ?? defaultWidthOf(id);
      let next: number;
      switch (event.key) {
        case "ArrowRight":
          next = current + (event.shiftKey ? KEY_STEP_LARGE : KEY_STEP);
          break;
        case "ArrowLeft":
          next = current - (event.shiftKey ? KEY_STEP_LARGE : KEY_STEP);
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = MAX_COLUMN_WIDTH;
          break;
        case "Enter":
        case " ":
        case "Spacebar":
          event.preventDefault();
          autofit(id);
          return;
        default:
          return;
      }
      event.preventDefault();
      commit(id, clampWidth(next, min));
    },
    [autofit, commit, defaultWidthOf, minWidthOf, widths],
  );

  const reset = React.useCallback((): void => {
    // Clear EVERY column's key (even hidden ones), then restore from the spec
    // defaults directly — never re-read storage, so a key cannot leak back.
    for (const id of COLUMN_IDS) removeStored(id);
    setWidths(() => {
      const next = {} as Record<ColumnId, number>;
      for (const column of columns) {
        next[column.id] = defaultOf(column);
      }
      return next;
    });
  }, [columns]);

  return {
    widths,
    tableWidth,
    cssVars,
    containerRef,
    minWidthOf,
    onPointerResizeStart,
    onKeyResize,
    autofit,
    reset,
  };
}
