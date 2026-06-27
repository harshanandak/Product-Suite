import { type KeyboardEvent } from "react";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_COLUMN_WIDTH,
  useColumnWidths,
  type ColumnWidthInput,
} from "./useColumnWidths";

/**
 * A representative slice of the real column specs: a primary column whose min
 * equals its default (name), a column with no explicit floor (type), and one
 * whose min sits below its default (tags) so the clamp is observable.
 */
const COLUMNS: readonly ColumnWidthInput[] = [
  { id: "name", width: "16rem", minWidth: "16rem" },
  { id: "type", width: "8.5rem" },
  { id: "tags", width: "10rem", minWidth: "8rem" },
];

/** Fixed selection (40) + actions (48) px folded into `tableWidth`. */
const EXTRA = 88;
const STORAGE_KEY = "workboard.table.colw.v1.name";

/** A minimal keyboard event for the resize handler (only `key`/`shiftKey` read). */
function keyEvent(key: string, shiftKey = false): KeyboardEvent {
  return { key, shiftKey, preventDefault: () => {} } as unknown as KeyboardEvent;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("useColumnWidths", () => {
  it("seeds px widths from each column's rem default", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    expect(result.current.widths.name).toBe(256);
    expect(result.current.widths.type).toBe(136);
    expect(result.current.widths.tags).toBe(160);
  });

  it("computes tableWidth as the sum of widths plus extraWidth", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    expect(result.current.tableWidth).toBe(256 + 136 + 160 + EXTRA);
  });

  it("exposes per-column and table CSS custom properties", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    const vars = result.current.cssVars as unknown as Record<string, string>;
    expect(vars["--col-name"]).toBe("256px");
    expect(vars["--table-width"]).toBe(`${256 + 136 + 160 + EXTRA}px`);
  });

  it("widens and persists on ArrowRight, with a larger Shift step", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    act(() => {
      result.current.onKeyResize("name", keyEvent("ArrowRight"));
    });
    expect(result.current.widths.name).toBe(272);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("272");

    act(() => {
      result.current.onKeyResize("name", keyEvent("ArrowRight", true));
    });
    expect(result.current.widths.name).toBe(272 + 64);
  });

  it("clamps to the column floor (Home then ArrowLeft holds)", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    act(() => {
      result.current.onKeyResize("tags", keyEvent("Home"));
    });
    expect(result.current.widths.tags).toBe(128);
    act(() => {
      result.current.onKeyResize("tags", keyEvent("ArrowLeft"));
    });
    expect(result.current.widths.tags).toBe(128);
  });

  it("clamps to the maximum on End", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    act(() => {
      result.current.onKeyResize("name", keyEvent("End"));
    });
    expect(result.current.widths.name).toBe(MAX_COLUMN_WIDTH);
  });

  it("reads a persisted width on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "300");
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    expect(result.current.widths.name).toBe(300);
  });

  it("ignores a non-numeric persisted value and falls back to the default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-number");
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    expect(result.current.widths.name).toBe(256);
  });

  it("reset() restores defaults and clears the persisted keys", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    act(() => {
      result.current.onKeyResize("name", keyEvent("ArrowRight"));
    });
    expect(result.current.widths.name).toBe(272);

    act(() => {
      result.current.reset();
    });
    expect(result.current.widths.name).toBe(256);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("minWidthOf returns each column's floor", () => {
    const { result } = renderHook(() => useColumnWidths(COLUMNS, EXTRA));
    expect(result.current.minWidthOf("tags")).toBe(128);
    expect(result.current.minWidthOf("name")).toBe(256);
  });
});
