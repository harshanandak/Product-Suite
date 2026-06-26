import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Owner, WorkItemPatch } from "@/data/work-items";

import {
  defaultWorkboardFilterState,
  FILTER_OWNER_UNASSIGNED,
  type WorkboardFilterState,
} from "../filter-state";
import { WorkboardToolbar } from "./WorkboardToolbar";

/**
 * Radix DropdownMenu / Select (which back the toolbar's facet menus and the
 * bulk pickers) need the Pointer-Capture and `scrollIntoView` APIs that jsdom
 * omits; without them the portalled menu/listbox never opens. These shims mirror
 * the ones in `WorkboardTable.test.tsx` (the shared test/setup.ts is out of this
 * dir's ownership). No virtualizer here, so the offset/ResizeObserver shims are
 * intentionally dropped.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterAll(() => {
  vi.restoreAllMocks();
});

const OWNERS: ReadonlyArray<Owner> = [
  { id: "u_ada", name: "Ada Lovelace" },
  { id: "u_alan", name: "Alan Turing" },
];

const DEPARTMENTS: ReadonlyArray<string> = ["Engineering", "Design"];

/**
 * Render the toolbar wired to a `vi.fn` `onChange` and a fresh default state.
 * Returns the harness plus a helper to read the most recent state handed up.
 */
function renderToolbar(overrides?: {
  value?: Partial<WorkboardFilterState>;
  selectedCount?: number;
}) {
  const onChange = vi.fn<(next: WorkboardFilterState) => void>();
  const onNewItem = vi.fn();
  const onBulkApply = vi.fn<(patch: WorkItemPatch) => void>();
  const value: WorkboardFilterState = {
    ...defaultWorkboardFilterState(),
    ...overrides?.value,
  };

  render(
    <WorkboardToolbar
      value={value}
      onChange={onChange}
      owners={OWNERS}
      departments={DEPARTMENTS}
      selectedCount={overrides?.selectedCount ?? 0}
      onNewItem={onNewItem}
      onBulkApply={onBulkApply}
    />,
  );

  return {
    onChange,
    onNewItem,
    onBulkApply,
    /** The state object from the most recent `onChange` call. */
    lastChange: (): WorkboardFilterState =>
      onChange.mock.calls.at(-1)?.[0] as WorkboardFilterState,
  };
}

/**
 * Open a Radix `DropdownMenu` by its trigger's accessible name. The trigger
 * TOGGLES on pointer/click (unlike Radix Select), so a pointer-then-click
 * sequence would re-close it; the keyboard path (ArrowDown — canonical: opens
 * and focuses the first item) opens it cleanly and is already proven to work in
 * this file's shim setup.
 */
function openMenu(triggerName: string | RegExp): void {
  const trigger = screen.getByRole("button", { name: triggerName });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

describe("WorkboardToolbar", () => {
  it("renders the search input with placeholder and the '/' hint", () => {
    renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    expect(search).toHaveAttribute("placeholder", "Search work items");
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("emits a new state with the updated search (controlled, no mutation)", () => {
    const { onChange, lastChange } = renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    fireEvent.change(search, { target: { value: "auth" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange().search).toBe("auth");
  });

  it("toggles a Type facet into a fresh filter set", async () => {
    const { onChange, lastChange } = renderToolbar();
    openMenu(/filter by type/i);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Feature" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = lastChange();
    expect([...next.filters.type]).toEqual(["feature"]);
  });

  it("offers an Unassigned option in the Owner facet using the sentinel", async () => {
    const { lastChange } = renderToolbar();
    openMenu(/filter by owner/i);
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Ada Lovelace" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Unassigned" }),
    );
    expect([...lastChange().filters.owner]).toEqual([FILTER_OWNER_UNASSIGNED]);
  });

  it("populates the Department facet from the departments prop", async () => {
    const { lastChange } = renderToolbar();
    openMenu(/filter by department/i);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Engineering" }),
    );
    expect([...lastChange().filters.department]).toEqual(["Engineering"]);
  });

  it("toggles a Priority facet into a fresh filter set", async () => {
    const { onChange, lastChange } = renderToolbar();
    openMenu(/filter by priority/i);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "High" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...lastChange().filters.priority]).toEqual(["high"]);
  });

  it("surfaces the active count in a facet trigger's accessible name", () => {
    const value: Partial<WorkboardFilterState> = {
      filters: {
        type: new Set(),
        owner: new Set(),
        department: new Set(),
        phase: new Set(),
        priority: new Set(["high", "low"]),
      },
    };
    renderToolbar({ value });
    expect(
      screen.getByRole("button", { name: "Filter by priority (2)" }),
    ).toBeInTheDocument();
  });

  it("shows an active-filter count and a Clear filters action when filters are set", () => {
    const value: Partial<WorkboardFilterState> = {
      filters: {
        type: new Set(["bug"]),
        owner: new Set(["u_ada"]),
        department: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    };
    const { onChange, lastChange } = renderToolbar({ value });
    const clear = screen.getByRole("button", { name: /clear filters/i });
    expect(clear).toHaveAccessibleName(/2 active/i);

    fireEvent.click(clear);
    const next = lastChange();
    expect(next.filters.type.size).toBe(0);
    expect(next.filters.owner.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("changes the group-by field via the radio menu", async () => {
    const { lastChange } = renderToolbar();
    openMenu("Group by");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Phase" }));
    expect(lastChange().groupBy).toBe("phase");
  });

  it("toggles a column off via the columns menu", async () => {
    const { lastChange } = renderToolbar();
    openMenu("Columns");
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Tags" }),
    );
    const next = lastChange();
    expect(next.visibleColumns.has("tags")).toBe(false);
    // Other columns are untouched.
    expect(next.visibleColumns.has("name")).toBe(true);
  });

  it("fires onNewItem when the New work item button is clicked", () => {
    const { onNewItem } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: /new work item/i }));
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it("hides the bulk-action cluster when nothing is selected", () => {
    renderToolbar({ selectedCount: 0 });
    expect(
      screen.queryByRole("group", { name: "Bulk actions" }),
    ).not.toBeInTheDocument();
  });

  it("shows the selected count and bulk action menus when rows are selected", () => {
    renderToolbar({ selectedCount: 3 });
    const cluster = screen.getByRole("group", { name: "Bulk actions" });
    expect(cluster).toHaveTextContent("3 selected");
    expect(
      screen.getByRole("button", { name: "Set phase" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set priority" }),
    ).toBeInTheDocument();
  });

  it("applies a bulk phase patch via an explicit menu action", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Set phase");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Review" }));
    expect(onBulkApply).toHaveBeenCalledWith({ phase: "review" });
  });

  it("applies a bulk priority patch via an explicit menu action", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Set priority");
    fireEvent.click(await screen.findByRole("menuitem", { name: "High" }));
    expect(onBulkApply).toHaveBeenCalledWith({ priority: "high" });
  });

  it("clears the selection via the Clear selection affordance", () => {
    const value: Partial<WorkboardFilterState> = {
      selection: new Set(["wi_1", "wi_2"]),
    };
    const { lastChange } = renderToolbar({ value, selectedCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(lastChange().selection.size).toBe(0);
  });
});
