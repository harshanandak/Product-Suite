import { describe, expect, it } from "vitest";

import {
  type CellCoord,
  type NavRow,
  commandForKey,
  computeNextCell,
  resolveActiveCell,
} from "./gridNavigation";

/**
 * A representative flat list mixing swimlane GROUP rows (only column 1 is
 * navigable — the select-all checkbox) with leaf ITEM rows (all columns
 * navigable). `colCount` is the grid's max 1-based aria-colindex for an item
 * row (selection + data columns + actions).
 */
const ROWS: NavRow[] = [
  { kind: "group", key: "group:Eng" },
  { kind: "item", key: "item:a" },
  { kind: "item", key: "item:b" },
  { kind: "group", key: "group:Mkt" },
  { kind: "item", key: "item:c" },
];
const COL_COUNT = 4;

function at(rowKey: string, colIndex: number): CellCoord {
  return { rowKey, colIndex };
}

describe("computeNextCell", () => {
  it("moves right one column and clamps at the last column", () => {
    expect(computeNextCell(ROWS, COL_COUNT, at("item:a", 1), "right")).toEqual(
      at("item:a", 2),
    );
    // Already at the last navigable column → clamp (no wrap).
    expect(
      computeNextCell(ROWS, COL_COUNT, at("item:a", COL_COUNT), "right"),
    ).toEqual(at("item:a", COL_COUNT));
  });

  it("moves left one column and clamps at the first column", () => {
    expect(computeNextCell(ROWS, COL_COUNT, at("item:a", 3), "left")).toEqual(
      at("item:a", 2),
    );
    expect(computeNextCell(ROWS, COL_COUNT, at("item:a", 1), "left")).toEqual(
      at("item:a", 1),
    );
  });

  it("moves down one row preserving the column and clamps at the bottom", () => {
    expect(computeNextCell(ROWS, COL_COUNT, at("item:a", 3), "down")).toEqual(
      at("item:b", 3),
    );
    // Last row → clamp to itself.
    expect(computeNextCell(ROWS, COL_COUNT, at("item:c", 2), "down")).toEqual(
      at("item:c", 2),
    );
  });

  it("moves up one row preserving the column and clamps at the top", () => {
    expect(computeNextCell(ROWS, COL_COUNT, at("item:b", 3), "up")).toEqual(
      at("item:a", 3),
    );
    // First row → clamp to itself (and col clamps to the group's single column).
    expect(computeNextCell(ROWS, COL_COUNT, at("group:Eng", 1), "up")).toEqual(
      at("group:Eng", 1),
    );
  });

  it("Home/End move to the row's first/last navigable column", () => {
    expect(computeNextCell(ROWS, COL_COUNT, at("item:b", 3), "home")).toEqual(
      at("item:b", 1),
    );
    expect(computeNextCell(ROWS, COL_COUNT, at("item:b", 2), "end")).toEqual(
      at("item:b", COL_COUNT),
    );
  });

  it("gridHome/gridEnd jump to the very first/last navigable cell", () => {
    expect(
      computeNextCell(ROWS, COL_COUNT, at("item:b", 3), "gridHome"),
    ).toEqual(at("group:Eng", 1));
    expect(
      computeNextCell(ROWS, COL_COUNT, at("item:a", 2), "gridEnd"),
    ).toEqual(at("item:c", COL_COUNT));
  });

  it("treats a group row as a single navigable column (col 1 only)", () => {
    // Right/End on a group row stay on column 1.
    expect(
      computeNextCell(ROWS, COL_COUNT, at("group:Eng", 1), "right"),
    ).toEqual(at("group:Eng", 1));
    expect(computeNextCell(ROWS, COL_COUNT, at("group:Mkt", 1), "end")).toEqual(
      at("group:Mkt", 1),
    );
    // Moving DOWN from an item cell at col 3 into a group row lands on col 1
    // (the group's select-all checkbox), not col 3.
    expect(computeNextCell(ROWS, COL_COUNT, at("item:b", 3), "down")).toEqual(
      at("group:Mkt", 1),
    );
  });

  it("re-resolves a stale row key to the first row before moving", () => {
    // A coordinate whose key is gone (filtered out) falls back to index 0.
    expect(
      computeNextCell(ROWS, COL_COUNT, at("item:ghost", 2), "down"),
    ).toEqual(at("item:a", 1));
  });

  it("is a no-op on an empty grid", () => {
    expect(computeNextCell([], COL_COUNT, at("item:a", 1), "down")).toEqual(
      at("item:a", 1),
    );
  });
});

describe("resolveActiveCell", () => {
  it("returns null for an empty grid", () => {
    expect(resolveActiveCell([], null, COL_COUNT)).toBeNull();
  });

  it("defaults to the first row's first column when unset", () => {
    expect(resolveActiveCell(ROWS, null, COL_COUNT)).toEqual(
      at("group:Eng", 1),
    );
  });

  it("falls back to the first cell when the active key is gone", () => {
    expect(resolveActiveCell(ROWS, at("item:ghost", 3), COL_COUNT)).toEqual(
      at("group:Eng", 1),
    );
  });

  it("clamps a surviving key's column into the row's range", () => {
    // An item key keeps its column (clamped to colCount)…
    expect(resolveActiveCell(ROWS, at("item:a", 99), COL_COUNT)).toEqual(
      at("item:a", COL_COUNT),
    );
    // …a group key collapses to col 1.
    expect(resolveActiveCell(ROWS, at("group:Mkt", 3), COL_COUNT)).toEqual(
      at("group:Mkt", 1),
    );
  });
});

describe("commandForKey", () => {
  it("maps arrow keys", () => {
    const mod = { ctrl: false, meta: false };
    expect(commandForKey("ArrowLeft", mod)).toBe("left");
    expect(commandForKey("ArrowRight", mod)).toBe("right");
    expect(commandForKey("ArrowUp", mod)).toBe("up");
    expect(commandForKey("ArrowDown", mod)).toBe("down");
  });

  it("maps Home/End, escalating to grid jumps with Ctrl or Meta", () => {
    expect(commandForKey("Home", { ctrl: false, meta: false })).toBe("home");
    expect(commandForKey("End", { ctrl: false, meta: false })).toBe("end");
    expect(commandForKey("Home", { ctrl: true, meta: false })).toBe("gridHome");
    expect(commandForKey("End", { ctrl: false, meta: true })).toBe("gridEnd");
  });

  it("returns null for unrelated keys", () => {
    expect(commandForKey("Enter", { ctrl: false, meta: false })).toBeNull();
    expect(commandForKey("a", { ctrl: false, meta: false })).toBeNull();
  });
});
