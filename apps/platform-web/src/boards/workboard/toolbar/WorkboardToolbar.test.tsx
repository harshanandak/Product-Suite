import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Owner, WorkItemPatch } from "@/data/work-items";

import {
  defaultWorkboardFilterState,
  type ColumnId,
  type SavedView,
  type WorkboardFilterState,
} from "../filter-state";
import type { ColumnFilter } from "../table/WorkboardTable";
import { WorkboardToolbar } from "./WorkboardToolbar";

/** jsdom has no ResizeObserver; the Save-view Radix Dialog needs one to mount. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

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
  globalThis.ResizeObserver ??= ResizeObserverStub;
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
  view?: "table" | "kanban";
  columnFilters?: Partial<Record<ColumnId, ColumnFilter>>;
  savedViews?: ReadonlyArray<SavedView>;
  hideTeamFacet?: boolean;
}) {
  const onChange = vi.fn<(next: WorkboardFilterState) => void>();
  const onNewItem = vi.fn();
  const onBulkApply = vi.fn<(patch: WorkItemPatch) => void>();
  const onViewChange = vi.fn<(view: "table" | "kanban") => void>();
  const onApplyView = vi.fn<(view: SavedView) => void>();
  const onSaveView = vi.fn<(name: string) => void>();
  const onDeleteView = vi.fn<(id: string) => void>();
  const value: WorkboardFilterState = {
    ...defaultWorkboardFilterState(),
    ...overrides?.value,
  };

  render(
    <WorkboardToolbar
      value={value}
      onChange={onChange}
      view={overrides?.view ?? "table"}
      onViewChange={onViewChange}
      owners={OWNERS}
      departments={DEPARTMENTS}
      hideTeamFacet={overrides?.hideTeamFacet}
      selectedCount={overrides?.selectedCount ?? 0}
      onNewItem={onNewItem}
      onBulkApply={onBulkApply}
      columnFilters={overrides?.columnFilters}
      savedViews={overrides?.savedViews ?? []}
      onApplyView={onApplyView}
      onSaveView={onSaveView}
      onDeleteView={onDeleteView}
    />,
  );

  return {
    onChange,
    onNewItem,
    onBulkApply,
    onViewChange,
    onApplyView,
    onSaveView,
    onDeleteView,
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
  it("renders the Table/Kanban view switcher and reports the picked view", () => {
    const { onViewChange } = renderToolbar();
    // The switcher leads the toolbar (the page header + standalone tabs row were
    // removed), exposing both views as tabs…
    expect(screen.getByRole("tab", { name: "Table" })).toBeInTheDocument();
    // …and picking one reports the normalized view up to the screen. Radix tabs
    // activate on mousedown (the left-button handler), not the synthetic click
    // event, so drive mousedown to mirror a real pointer pick.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Kanban" }));
    expect(onViewChange).toHaveBeenCalledWith("kanban");
  });

  it("renders the search input with placeholder and the '/' hint", () => {
    renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    expect(search).toHaveAttribute("placeholder", "Search work items");
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("focuses the search input when '/' is pressed outside a field (#11)", () => {
    renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    expect(search).not.toHaveFocus();
    // A bare '/' keydown anywhere on the page (focus rests on <body>) routes to
    // the searchbox — the window listener prevents the literal slash and focuses.
    fireEvent.keyDown(document, { key: "/" });
    expect(search).toHaveFocus();
  });

  it("ignores the '/' shortcut while typing in a field (#11)", () => {
    renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    // With focus already inside an input, '/' must reach the field as a literal
    // slash rather than being intercepted — the guard leaves focus put.
    search.focus();
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "/" });
    expect(search).toHaveFocus();
  });

  it("emits a new state with the updated search (controlled, no mutation)", () => {
    const { onChange, lastChange } = renderToolbar();
    const search = screen.getByRole("searchbox", { name: "Search work items" });
    fireEvent.change(search, { target: { value: "auth" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastChange().search).toBe("auth");
  });

  it("populates the Department facet from the departments prop", async () => {
    const { lastChange } = renderToolbar();
    openMenu(/filter by department/i);
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Engineering" }),
    );
    expect([...lastChange().filters.department]).toEqual(["Engineering"]);
  });

  it("hides the Department facet when hideTeamFacet is set (team-scoped surface)", () => {
    renderToolbar({ hideTeamFacet: true });
    expect(
      screen.queryByRole("button", { name: /filter by department/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * The Type/Phase/Priority/Owner facets live in the TABLE column headers, but
   * Kanban has no headers — so for the Kanban view they fall back into the
   * toolbar (the same `columnFilters` config the table consumes), keeping every
   * facet reachable in both views.
   */
  const COLUMN_FILTERS: Partial<Record<ColumnId, ColumnFilter>> = {
    type: {
      options: [{ value: "bug", label: "Bug" }],
      selected: new Set<string>(),
      onToggle: () => {},
    },
    phase: {
      options: [{ value: "plan", label: "Plan" }],
      selected: new Set<string>(),
      onToggle: () => {},
    },
    priority: {
      options: [{ value: "high", label: "High" }],
      selected: new Set<string>(),
      onToggle: () => {},
    },
    owner: {
      options: [{ value: "u_ada", label: "Ada Lovelace" }],
      selected: new Set<string>(),
      onToggle: () => {},
      searchable: true,
    },
  };

  it("renders the Type/Phase/Priority/Owner facets in the toolbar for the Kanban view", () => {
    renderToolbar({ view: "kanban", columnFilters: COLUMN_FILTERS });
    for (const facet of ["type", "phase", "priority", "owner"]) {
      expect(
        screen.getByRole("button", { name: `Filter by ${facet}` }),
      ).toBeInTheDocument();
    }
  });

  it("keeps those facets OUT of the toolbar for the Table view (they live in the column headers)", () => {
    renderToolbar({ view: "table", columnFilters: COLUMN_FILTERS });
    for (const facet of ["type", "phase", "priority", "owner"]) {
      expect(
        screen.queryByRole("button", { name: `Filter by ${facet}` }),
      ).not.toBeInTheDocument();
    }
    // Department is unconditional (it has no column), so it stays in both views.
    expect(
      screen.getByRole("button", { name: /filter by department/i }),
    ).toBeInTheDocument();
  });

  it("falls a facet back into the toolbar when its column is HIDDEN in Table view", () => {
    // Hiding `type` from the Columns menu removes its only trigger (the column
    // header), so the toolbar must carry it to keep the filter reachable.
    const visibleColumns = new Set(
      defaultWorkboardFilterState().visibleColumns,
    );
    visibleColumns.delete("type");
    renderToolbar({
      view: "table",
      columnFilters: COLUMN_FILTERS,
      value: { visibleColumns },
    });
    expect(
      screen.getByRole("button", { name: "Filter by type" }),
    ).toBeInTheDocument();
    // Still-visible columns keep their facet in the header, not the toolbar.
    expect(
      screen.queryByRole("button", { name: "Filter by phase" }),
    ).not.toBeInTheDocument();
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

  it("shows Clear filters for a search alone and resets the search too (#15)", () => {
    const { lastChange } = renderToolbar({ value: { search: "auth" } });
    const clear = screen.getByRole("button", { name: /clear filters/i });
    // The trimmed search counts as one active filter…
    expect(clear).toHaveAccessibleName(/1 active/i);
    fireEvent.click(clear);
    // …and clearing resets the search string (not just the facets).
    expect(lastChange().search).toBe("");
  });

  it("does not count a whitespace-only search toward Clear filters (#15)", () => {
    renderToolbar({ value: { search: "   " } });
    expect(
      screen.queryByRole("button", { name: /clear filters/i }),
    ).not.toBeInTheDocument();
  });

  it("clears the search alongside the facets when both are set (#15)", () => {
    const { lastChange } = renderToolbar({
      value: {
        search: "auth",
        filters: {
          type: new Set(["bug"]),
          owner: new Set(),
          department: new Set(),
          phase: new Set(),
          priority: new Set(),
        },
      },
    });
    // search (1) + type (1) → "2 active".
    const clear = screen.getByRole("button", { name: /clear filters/i });
    expect(clear).toHaveAccessibleName(/2 active/i);
    fireEvent.click(clear);
    const next = lastChange();
    expect(next.search).toBe("");
    expect(next.filters.type.size).toBe(0);
  });

  it("renders a removable chip per active facet value and removes just that one (#13)", () => {
    const value: Partial<WorkboardFilterState> = {
      filters: {
        type: new Set(["feature", "bug"]),
        owner: new Set(["u_ada"]),
        department: new Set(),
        phase: new Set(),
        priority: new Set(),
      },
    };
    const { onChange, lastChange } = renderToolbar({ value });
    // One chip per selected value, labelled "<Facet>: <Value>" and removable.
    expect(
      screen.getByRole("button", { name: "Remove Type Feature" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Type Bug" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Owner Ada Lovelace" }),
    ).toBeInTheDocument();

    // Removing one chip drops only that value (via the single-value toggle).
    fireEvent.click(screen.getByRole("button", { name: "Remove Type Feature" }));
    const next = lastChange();
    expect([...next.filters.type]).toEqual(["bug"]);
    expect([...next.filters.owner]).toEqual(["u_ada"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders no active-filter chips when no facet is selected (#13)", () => {
    renderToolbar();
    expect(
      screen.queryByRole("group", { name: "Active filters" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument();
  });

  it("does not chip a free-text search (#13)", () => {
    renderToolbar({ value: { search: "auth" } });
    expect(
      screen.queryByRole("group", { name: "Active filters" }),
    ).not.toBeInTheDocument();
  });

  it("changes the group-by field via the radio menu", async () => {
    const { lastChange } = renderToolbar();
    openMenu("Group by");
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Phase" }));
    expect(lastChange().groupBy).toBe("phase");
  });

  it("labels the no-grouping option 'No grouping' (not 'None')", async () => {
    renderToolbar();
    openMenu("Group by");
    expect(
      await screen.findByRole("menuitemradio", { name: "No grouping" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitemradio", { name: "None" }),
    ).not.toBeInTheDocument();
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

  it("assigns a bulk owner via an explicit menu action (#16)", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Assign owner");
    // Every owner is listed by name…
    expect(
      await screen.findByRole("menuitem", { name: "Alan Turing" }),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Ada Lovelace" }),
    );
    expect(onBulkApply).toHaveBeenCalledWith({ assignee_id: "u_ada" });
  });

  it("clears a bulk owner via the Unassigned menu action (#16)", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Assign owner");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Unassigned" }),
    );
    // Unassigned must map to a real null, NOT the filter's owner sentinel.
    expect(onBulkApply).toHaveBeenCalledWith({ assignee_id: null });
  });

  it("archives the selection via an explicit menu action (#16)", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Archive");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Archive selected" }),
    );
    expect(onBulkApply).toHaveBeenCalledWith({ archived: true });
  });

  it("restores the selection via an explicit menu action (#16)", async () => {
    const { onBulkApply } = renderToolbar({ selectedCount: 2 });
    openMenu("Archive");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Restore selected" }),
    );
    expect(onBulkApply).toHaveBeenCalledWith({ archived: false });
  });

  it("hides the Assign owner and Archive controls when nothing is selected (#16)", () => {
    renderToolbar({ selectedCount: 0 });
    expect(
      screen.queryByRole("button", { name: "Assign owner" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });

  it("clears the selection via the Clear selection affordance", () => {
    const value: Partial<WorkboardFilterState> = {
      selection: new Set(["wi_1", "wi_2"]),
    };
    const { lastChange } = renderToolbar({ value, selectedCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(lastChange().selection.size).toBe(0);
  });

  // --- Saved / named views (Rank 8b) -------------------------------------

  const SAVED_VIEWS: ReadonlyArray<SavedView> = [
    { id: "v1", name: "Execute lane", config: { search: "auth" } },
    { id: "v2", name: "All done", config: { groupBy: "phase" } },
  ];

  it("shows an empty state when no views are saved", async () => {
    renderToolbar();
    openMenu("Saved views");
    expect(await screen.findByText("No saved views yet")).toBeInTheDocument();
  });

  it("lists every saved view in the Saved views menu", async () => {
    renderToolbar({ savedViews: SAVED_VIEWS });
    openMenu("Saved views");
    expect(
      await screen.findByRole("menuitem", { name: "Execute lane" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "All done" }),
    ).toBeInTheDocument();
  });

  it("applies a saved view when its row is clicked", async () => {
    const { onApplyView } = renderToolbar({ savedViews: SAVED_VIEWS });
    openMenu("Saved views");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Execute lane" }));
    expect(onApplyView).toHaveBeenCalledTimes(1);
    expect(onApplyView).toHaveBeenCalledWith(SAVED_VIEWS[0]);
  });

  it("deletes a saved view by id WITHOUT applying it", async () => {
    const { onApplyView, onDeleteView } = renderToolbar({
      savedViews: SAVED_VIEWS,
    });
    openMenu("Saved views");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete view Execute lane" }),
    );
    expect(onDeleteView).toHaveBeenCalledTimes(1);
    expect(onDeleteView).toHaveBeenCalledWith("v1");
    // Deleting must never double as applying.
    expect(onApplyView).not.toHaveBeenCalled();
  });

  it("saves the current view under a typed (trimmed) name", async () => {
    const { onSaveView } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    const input = await screen.findByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "  Execute lane  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveView).toHaveBeenCalledTimes(1);
    expect(onSaveView).toHaveBeenCalledWith("Execute lane");
  });

  it("cannot save a view with an empty name", async () => {
    const { onSaveView } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    const save = await screen.findByRole("button", { name: "Save" });
    // The Save button is disabled until a non-empty name is typed.
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSaveView).not.toHaveBeenCalled();
  });
});
