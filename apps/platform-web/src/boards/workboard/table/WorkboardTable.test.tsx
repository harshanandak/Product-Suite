import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  COLUMN_IDS,
  type ColumnId,
} from "@/boards/workboard/filter-state";
import {
  createMockWorkItemRepository,
  createOwnerFixtures,
  type Owner,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRow,
} from "@/data/work-items";

import {
  WorkboardTable,
  type ColumnFilter,
  type WorkItemTableProps,
} from "./WorkboardTable";

/**
 * Open a row's "⋯" actions DropdownMenu. Radix opens its trigger on the
 * pointerdown sequence (absent in jsdom) but also on keyboard activation, so we
 * focus the trigger and press Enter — mirroring the `selectOption` pattern.
 */
function openRowMenu(title: string): void {
  const trigger = screen.getByRole("button", { name: `Actions for ${title}` });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/** Locate the rendered `work-item-row` whose Name cell shows `title`. */
function rowByTitle(title: string): HTMLElement {
  const titleButton = screen.getByRole("button", { name: title });
  const row = titleButton.closest('[data-testid="work-item-row"]');
  if (!(row instanceof HTMLElement)) {
    throw new TypeError(`No row found for "${title}"`);
  }
  return row;
}

/**
 * jsdom has no layout engine, so @tanstack/react-virtual sees a zero-height
 * scroll element and renders no rows. Its `getRect` reads `element.offsetWidth`
 * / `element.offsetHeight` (verified in virtual-core's source) — NOT
 * `getBoundingClientRect` — and `ResizeObserver` is undefined. We stub both so
 * the virtualizer believes it has a 600px viewport.
 *
 * Radix Select (which backs the shared `*Select` / `AssigneePicker` controls)
 * additionally needs the Pointer-Capture and `scrollIntoView` APIs that jsdom
 * omits; without these the listbox never opens. Both groups of shims are scoped
 * to this file (the shared test/setup.ts is out of this dir's ownership).
 */
class ResizeObserverStub {
  observe(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
  unobserve(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
  disconnect(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 800,
  });
  // Radix Select pointer/scroll plumbing absent in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom has no clipboard; the row menu + Name copy button write to it.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
});

/**
 * Open a Radix Select `combobox` trigger and click the option with `optionName`.
 * Mirrors a real keyboard-then-pointer interaction; the listbox is portalled, so
 * we query the option from the document, not from within the trigger.
 */
function selectOption(combobox: HTMLElement, optionName: string | RegExp): void {
  fireEvent.keyDown(combobox, { key: "Enter" });
  const option = screen.getByRole("option", { name: optionName });
  fireEvent.click(option);
}

/** Build real fixture-backed rows via the seam so health/counts are realistic. */
async function loadRows(): Promise<WorkItemRow[]> {
  const repository = createMockWorkItemRepository();
  const [items, tasks] = await Promise.all([
    repository.list(),
    repository.listTasks(),
  ]);
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  const { deriveHealth } = await import("@/data/work-items");
  return items.map((item) => {
    const itemTasks = tasks.filter((task) => task.work_item_id === item.id);
    return {
      ...item,
      health: deriveHealth(item, itemTasks, now),
      taskCount: itemTasks.length,
      completedTaskCount: itemTasks.filter((t) => t.status === "completed")
        .length,
    };
  });
}

/**
 * A `vi.fn` patch mock resolving the optimistically-patched row (the shape the
 * table expects back). Shared by the inline- and bulk-edit tests.
 */
function makeUpdateMock(rows: WorkItemRow[]) {
  return vi
    .fn<(id: string, patch: WorkItemPatch) => Promise<WorkItem>>()
    .mockImplementation((id, patch) =>
      Promise.resolve({
        ...(rows.find((r) => r.id === id) as WorkItem),
        ...patch,
      }),
    );
}

/**
 * Render the table with sane defaults for every REQUIRED prop, overridable per
 * test. `rows` / `owners` default to empty/fixtures; `selection` is empty; the
 * callbacks are spies. Pass `onUpdateItem` explicitly to exercise edit mode.
 */
function renderTable(overrides: Partial<WorkItemTableProps> = {}) {
  const props: WorkItemTableProps = {
    rows: [],
    owners: createOwnerFixtures(),
    loading: false,
    error: null,
    groupBy: "department",
    visibleColumns: new Set<ColumnId>(COLUMN_IDS),
    selection: new Set<string>(),
    onSelectionChange: vi.fn(),
    onSelectItem: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkboardTable {...props} />) };
}

// Column-width persistence reads localStorage on mount; isolate every test from
// any width a prior resize test committed so each seeds the canonical defaults.
beforeEach(() => {
  window.localStorage.clear();
});

describe("WorkboardTable", () => {
  it("renders a skeleton while loading", () => {
    renderTable({ loading: true });
    const skeleton = screen.getByTestId("workboard-table-skeleton");
    expect(skeleton).toBeInTheDocument();
    // a11y: the load is announced as a busy status region.
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveAttribute("role", "status");
  });

  it("renders an error state with a retry path", () => {
    const onRetry = vi.fn();
    renderTable({ error: new Error("boom"), onRetry });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("exposes an explicit selectable grid for assistive tech", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // The virtualization overrides strip the native table semantics, so the
    // container re-declares a real, multi-selectable grid (rows carry
    // aria-selected) — not a plain table.
    const grid = screen.getByRole("grid", { name: "Work items" });
    expect(grid).toHaveAttribute("aria-multiselectable", "true");
    // grid still supports aria-colcount: selection column + all 8 data columns.
    expect(grid).toHaveAttribute("aria-colcount", String(1 + COLUMN_IDS.length));
    // One columnheader per visible data column plus the leading selection header.
    expect(screen.getAllByRole("columnheader").length).toBe(1 + COLUMN_IDS.length);
    // Every row carries an explicit role despite the flex/absolute overrides.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
  });

  it("reveals the inline-select chevron on row hover without reserving width at rest", async () => {
    const rows = await loadRows();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // The chevron is absolutely positioned (out of flow → reserves NO width, so
    // the badge value reads full-width at rest — the "Feature" → "Fe" clip fix)
    // and fades in on ROW hover / focus-within so the cell is discoverable as
    // editable. Assert each editable trigger carries the hover-reveal classes
    // and no longer blanket-hides the chevron.
    for (const column of ["Type", "Phase", "Priority"]) {
      const trigger = screen.getByRole("combobox", {
        name: `${column} for Workspace auth hardening`,
      });
      const classes = trigger.className.split(" ");
      expect(classes).toContain("[&>svg]:absolute");
      expect(classes).toContain("group-hover:[&>svg]:opacity-50");
      expect(classes).toContain("group-focus-within:[&>svg]:opacity-50");
      expect(classes).not.toContain("[&>svg]:hidden");
    }
  });

  it("keeps the inline-select chevron visible on coarse-pointer (touch) devices", async () => {
    const rows = await loadRows();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // On no-hover / coarse-pointer devices the `group-hover` reveal never fires,
    // so the chevron must also be unveiled via the coarse-pointer media variant —
    // ALONGSIDE (not replacing) the fine-pointer hover reveal asserted above.
    for (const column of ["Type", "Phase", "Priority"]) {
      const trigger = screen.getByRole("combobox", {
        name: `${column} for Workspace auth hardening`,
      });
      const classes = trigger.className.split(" ");
      expect(classes).toContain("pointer-coarse:[&>svg]:opacity-50");
      // Fine-pointer hover reveal is preserved exactly.
      expect(classes).toContain("group-hover:[&>svg]:opacity-50");
      expect(classes).toContain("group-focus-within:[&>svg]:opacity-50");
    }
  });

  it("keeps the Name cell Copy button visible on coarse-pointer (touch) devices", async () => {
    const rows = await loadRows();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // The Copy button's label is title-agnostic, so every row exposes one; the
    // reveal class is identical on each, so assert against the first.
    const [copy] = screen.getAllByRole("button", { name: "Copy title" });
    const classes = copy.className.split(" ");
    // Always revealed on touch; hover + keyboard-focus reveals preserved.
    expect(classes).toContain("pointer-coarse:opacity-100");
    expect(classes).toContain("group-hover:opacity-100");
    expect(classes).toContain("focus-visible:opacity-100");
  });

  it("keeps the row-actions trigger visible on coarse-pointer (touch) devices", async () => {
    const rows = await loadRows();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    const trigger = screen.getByRole("button", {
      name: "Actions for Workspace auth hardening",
    });
    const classes = trigger.className.split(" ");
    // Always revealed on touch; hover + keyboard-focus + open reveals preserved.
    expect(classes).toContain("pointer-coarse:opacity-100");
    expect(classes).toContain("group-hover:opacity-100");
    expect(classes).toContain("focus-visible:opacity-100");
    expect(classes).toContain("data-[state=open]:opacity-100");
  });

  it("renders every wireframe column header in canonical order", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      "", // leading selection checkbox column has no text header
      "Name",
      "Type",
      "Phase",
      "Priority",
      "Owner",
      "Due",
      "Tags",
      "Source",
    ]);
  });

  it("renders rows with phase pills and department swimlanes", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Swimlane group headers render (group-by-department by default).
    expect(screen.getAllByTestId("swimlane-group").length).toBeGreaterThan(0);

    // A known fixture title is shown.
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();

    // Read-only phase still renders as a pill (data-phase attribute from it).
    expect(document.querySelectorAll("[data-phase]").length).toBeGreaterThan(0);
  });

  it("renders read-only Due and Source cells", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    const row = await within(
      (await screen.findAllByTestId("work-item-row"))[0],
    );
    // Source renders a ProvenanceChip carrying a data-source attribute.
    expect(document.querySelectorAll("[data-source]").length).toBeGreaterThan(0);
    // wi_auth's due_date 2026-07-10 surfaces as the compact "Mon D" label.
    expect(screen.getByText("Jul 10")).toBeInTheDocument();
    expect(row).toBeTruthy();
  });

  it("fires onSelectItem when a row title is clicked", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderTable({ rows, onSelectItem });

    const titleButton = await screen.findByRole("button", {
      name: "Workspace auth hardening",
    });
    fireEvent.click(titleButton);

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: "wi_auth" });
  });

  it("calls onUpdateItem when the inline phase select changes", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    const combobox = await screen.findByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    selectOption(combobox, "Done");

    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { phase: "done" });
  });

  it("calls onUpdateItem when the inline type select changes", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    const combobox = await screen.findByRole("combobox", {
      name: "Type for Workspace auth hardening",
    });
    selectOption(combobox, "Bug");

    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { type: "bug" });
  });

  it("calls onUpdateItem when the inline priority select changes", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    const combobox = await screen.findByRole("combobox", {
      name: "Priority for Workspace auth hardening",
    });
    selectOption(combobox, "Critical");

    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { priority: "critical" });
  });

  it("calls onUpdateItem when the inline owner picker changes", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    const combobox = await screen.findByRole("combobox", {
      name: "Owner for Workspace auth hardening",
    });
    // wi_auth is owned by Amara; reassign to a different owner. The option's
    // accessible name includes the avatar-fallback initials ("DP") alongside the
    // display name, so match the name as a substring.
    selectOption(combobox, /Dev Patel/);

    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", {
      assignee_id: "user_dev",
    });
  });

  it("calls onUpdateItem when a tag is added inline", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    // The Tags cell reads as a compact summary at rest; click it to expand into
    // the editable field before typing (the input is not mounted until then).
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit tags for Workspace auth hardening",
      }),
    );

    const tagInput = await screen.findByRole("textbox", {
      name: "Tags for Workspace auth hardening",
    });
    fireEvent.change(tagInput, { target: { value: "urgent" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    // wi_auth seeds ["security", "backend"]; the add appends "urgent".
    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", {
      tags: ["security", "backend", "urgent"],
    });
  });

  it("shows a compact tag summary with a +N overflow at rest and expands to the editable field on click", async () => {
    const rows = await loadRows();
    // Give wi_auth more tags than the inline cap (3) so the overflow shows.
    const tagged = rows.map((row) =>
      row.id === "wi_auth"
        ? { ...row, tags: ["alpha", "beta", "gamma", "delta", "epsilon"] }
        : row,
    );
    const onUpdateItem = makeUpdateMock(tagged);
    renderTable({ rows: tagged, onUpdateItem });

    await screen.findAllByTestId("work-item-row");

    // At rest the editable input is NOT mounted — the cell is a read-at-rest
    // summary surfaced as a single "Edit tags" trigger.
    expect(
      screen.queryByRole("textbox", {
        name: "Tags for Workspace auth hardening",
      }),
    ).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Edit tags for Workspace auth hardening",
    });
    // The first 3 tags read as chips; the remaining 2 collapse into a "+2" chip
    // so nothing is silently clipped.
    expect(within(trigger).getByText("alpha")).toBeInTheDocument();
    expect(within(trigger).getByText("+2")).toBeInTheDocument();

    // Clicking the summary expands it into the full editable TagInput.
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("textbox", {
        name: "Tags for Workspace auth hardening",
      }),
    ).toBeInTheDocument();
  });

  it("does not fire onSelectItem when the inline phase select changes", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderTable({
      rows,
      onSelectItem,
      onUpdateItem: vi.fn().mockResolvedValue(rows[0]),
    });

    const combobox = await screen.findByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    selectOption(combobox, "Review");

    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("toggles a row's selection through the controlled callback", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    renderTable({ rows, onSelectionChange });

    await screen.findAllByTestId("work-item-row");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0][0]]).toEqual(["wi_auth"]);
  });

  it("selects the inclusive range on a shift-click checkbox", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    // groupBy "none" → flatRows index == rows index == DOM order, so the range
    // is deterministic.
    renderTable({ rows, groupBy: "none", onSelectionChange });

    const rowEls = await screen.findAllByTestId("work-item-row");
    const checkboxOf = (el: HTMLElement): HTMLElement =>
      within(el).getByRole("checkbox");

    // A plain click sets the range anchor (and toggles the one row).
    fireEvent.click(checkboxOf(rowEls[0]));
    onSelectionChange.mockClear();

    // Shift-click three rows down selects the inclusive 0..2 range, not a toggle.
    fireEvent.click(checkboxOf(rowEls[2]), { shiftKey: true });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(next.has(rows[0].id)).toBe(true);
    expect(next.has(rows[1].id)).toBe(true);
    expect(next.has(rows[2].id)).toBe(true);
    expect(next.size).toBe(3);
  });

  it("treats a shift-click with no prior anchor as a single toggle", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    renderTable({ rows, groupBy: "none", onSelectionChange });

    const rowEls = await screen.findAllByTestId("work-item-row");
    // First-ever interaction is a shift-click → no live anchor → single toggle.
    fireEvent.click(within(rowEls[1]).getByRole("checkbox"), { shiftKey: true });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0][0]]).toEqual([rows[1].id]);
  });

  it("re-resolves the shift anchor by id after rows change (no stale-index range)", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    const { props, rerender } = renderTable({
      rows,
      groupBy: "none",
      onSelectionChange,
    });

    const rowEls = await screen.findAllByTestId("work-item-row");
    const checkboxOf = (el: HTMLElement): HTMLElement =>
      within(el).getByRole("checkbox");

    // Anchor on rows[1] with a plain click.
    fireEvent.click(checkboxOf(rowEls[1]));
    onSelectionChange.mockClear();

    // rows[1] (the anchor) is filtered OUT. A raw-index anchor would still point
    // at a now-different live row and drag a bogus range in; the id-based anchor
    // finds nothing in the new flatRows and must fall back to a single toggle.
    const remaining = rows.filter((row) => row.id !== rows[1].id);
    rerender(
      <WorkboardTable
        {...props}
        rows={remaining}
        selection={new Set([rows[1].id])}
      />,
    );

    const newRowEls = await screen.findAllByTestId("work-item-row");
    fireEvent.click(checkboxOf(newRowEls[newRowEls.length - 1]), {
      shiftKey: true,
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    // Only the clicked row joins the existing selection — no middle rows pulled
    // in by a stale index (a raw-index anchor would have given size 3).
    expect(next.has(remaining[remaining.length - 1].id)).toBe(true);
    expect(next.size).toBe(2);
  });

  it("reflects a partial selection as an indeterminate select-all checkbox", async () => {
    const rows = await loadRows();
    // Pre-seed a single-row selection (controlled): header must read mixed.
    renderTable({ rows, selection: new Set(["wi_auth"]) });

    await screen.findAllByTestId("work-item-row");

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all work items",
    });
    expect(selectAll).toHaveAttribute("aria-checked", "mixed");
  });

  it("gives a selected row a distinct cue that wins over hover", async () => {
    const rows = await loadRows();
    renderTable({ rows, selection: new Set(["wi_auth"]) });

    await screen.findAllByTestId("work-item-row");

    const row = rowByTitle("Workspace auth hardening");
    expect(row).toHaveAttribute("data-state", "selected");
    const classes = row.className.split(" ");
    // A primary tint authored as both the selected AND hover variant, plus an
    // out-of-flow left accent rail (non-background cue).
    expect(classes).toContain("data-[state=selected]:bg-primary/10");
    expect(classes).toContain("hover:bg-primary/10");
    expect(classes).toContain("before:bg-primary");
    // twMerge dropped the shared TableRow's muted selected/hover backgrounds, so
    // hovering a selected row can never lighten it back to the generic hue.
    expect(classes).not.toContain("data-[state=selected]:bg-muted");
    expect(classes).not.toContain("hover:bg-muted/50");
  });

  it("does not read 'all selected' when selection holds ids not in visible rows", async () => {
    const rows = await loadRows();
    // Seed selection with EVERY visible id plus a stale off-screen id: raw
    // size-equality would mis-read this as a partial (size > rows.length), but
    // visible membership is full → the header must read fully checked.
    const selection = new Set([...rows.map((r) => r.id), "wi_stale_offscreen"]);
    renderTable({ rows, selection });

    await screen.findAllByTestId("work-item-row");

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all work items",
    });
    expect(selectAll).toHaveAttribute("aria-checked", "true");
  });

  it("preserves off-screen selection when toggling select-all", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    // Nothing visible selected yet, but a stale off-screen id is held.
    renderTable({
      rows,
      selection: new Set(["wi_stale_offscreen"]),
      onSelectionChange,
    });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );

    // Selecting all adds the visible ids while keeping the off-screen id.
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(next.has("wi_stale_offscreen")).toBe(true);
    for (const row of rows) {
      expect(next.has(row.id)).toBe(true);
    }
  });

  it("clears only visible rows when un-toggling select-all, keeping off-screen ids", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    // All visible rows selected, plus a stale off-screen id → header reads "all".
    renderTable({
      rows,
      selection: new Set([...rows.map((r) => r.id), "wi_stale_offscreen"]),
      onSelectionChange,
    });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );

    // Clearing removes the visible ids but preserves the off-screen selection.
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(next.has("wi_stale_offscreen")).toBe(true);
    for (const row of rows) {
      expect(next.has(row.id)).toBe(false);
    }
  });

  it("renders no bulk-actions toolbar (bulk lives in the screen toolbar)", async () => {
    const rows = await loadRows();
    renderTable({
      rows,
      onUpdateItem: makeUpdateMock(rows),
      selection: new Set(["wi_auth"]),
    });

    await screen.findAllByTestId("work-item-row");

    // Selection no longer renders a "Bulk actions" toolbar or an Apply button.
    expect(
      screen.queryByRole("toolbar", { name: "Bulk actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /apply phase/i }),
    ).not.toBeInTheDocument();
  });

  it("renders selection checkboxes but no inline editors without a mutator", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await screen.findAllByTestId("work-item-row");

    // Selection is independent of the mutator — checkboxes still render.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    // …but no editable comboboxes / tag textboxes in read-only mode.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", {
        name: "Tags for Workspace auth hardening",
      }),
    ).not.toBeInTheDocument();
    // The read-only phase still renders as a pill.
    const firstRow = screen.getAllByTestId("work-item-row")[0];
    expect(within(firstRow).getByText(/plan|execute|review|done/i)).toBeTruthy();
  });

  it("groups rows by phase when groupBy is phase", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "phase" });

    await screen.findAllByTestId("work-item-row");

    const groupLabels = screen
      .getAllByTestId("swimlane-group")
      .map((node) => node.dataset.group);
    // Phase labels (not departments) head the swimlanes.
    expect(groupLabels).toContain("Plan");
    expect(groupLabels).toContain("Execute");
    expect(groupLabels).not.toContain("Engineering");
  });

  it("renders a flat list with no swimlanes when groupBy is none", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });

    await screen.findAllByTestId("work-item-row");
    expect(screen.queryByTestId("swimlane-group")).not.toBeInTheDocument();
  });

  it("shows only the columns in visibleColumns, in canonical order", async () => {
    const rows = await loadRows();
    renderTable({
      rows,
      visibleColumns: new Set<ColumnId>(["name", "priority"]),
    });

    await screen.findAllByTestId("work-item-row");

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    // Selection column + the two visible data columns only.
    expect(headers).toEqual(["", "Name", "Priority"]);
    expect(
      screen.getByRole("grid", { name: "Work items" }),
    ).toHaveAttribute("aria-colcount", "3");
    // A hidden column's header is absent.
    expect(
      screen.queryByRole("columnheader", { name: "Source" }),
    ).not.toBeInTheDocument();
  });

  it("accepts an empty owners list", async () => {
    const rows = await loadRows();
    const owners: Owner[] = [];
    renderTable({ rows, owners });

    await screen.findAllByTestId("work-item-row");
    // wi_auth's assignee cannot resolve → falls back to "Unassigned" text.
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
  });

  it("de-emphasizes an archived row and shows an Archived indicator", async () => {
    const rows = await loadRows();
    // Fixtures seed only active items; mark one archived by hand.
    const archived = rows.map((row) =>
      row.id === "wi_auth" ? { ...row, archived: true } : row,
    );
    renderTable({ rows: archived });

    await screen.findAllByTestId("work-item-row");

    const row = rowByTitle("Workspace auth hardening");
    // A muted text token marks the row as de-emphasized — but NOT a blanket
    // opacity dim (which also washed out the full-opacity status badges).
    expect(row).toHaveClass("text-muted-foreground");
    expect(row).not.toHaveClass("opacity-60");
    expect(row).toHaveAttribute("data-archived", "true");
    // Non-contrast archived cue: the title is struck through (not just dimmed).
    const archivedTitle = within(row).getByRole("button", {
      name: "Workspace auth hardening",
    });
    expect(archivedTitle).toHaveClass("line-through");
    // A small "Archived" indicator renders in the row.
    expect(within(row).getByTestId("archived-indicator")).toHaveTextContent(
      "Archived",
    );
  });

  it("keeps selection and inline edit working on an archived row", async () => {
    const rows = await loadRows();
    const archived = rows.map((row) =>
      row.id === "wi_auth" ? { ...row, archived: true } : row,
    );
    const onSelectionChange = vi.fn();
    const onUpdateItem = makeUpdateMock(archived);
    renderTable({ rows: archived, onSelectionChange, onUpdateItem });

    await screen.findAllByTestId("work-item-row");

    // Selection still fires on the archived row.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );
    expect([...onSelectionChange.mock.calls[0][0]]).toEqual(["wi_auth"]);

    // Inline edit still fires on the archived row.
    const combobox = screen.getByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    selectOption(combobox, "Done");
    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { phase: "done" });
  });

  it("does not render the row actions menu without a mutator", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await screen.findAllByTestId("work-item-row");
    expect(
      screen.queryByRole("button", {
        name: "Actions for Workspace auth hardening",
      }),
    ).not.toBeInTheDocument();
  });

  it("opens the row actions menu and Archive calls onUpdateItem with archived:true", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);
    renderTable({ rows, onUpdateItem });

    await screen.findAllByTestId("work-item-row");

    openRowMenu("Workspace auth hardening");

    // Menu items render: Open, Copy ID, Archive (wi_auth is not archived).
    expect(
      await screen.findByRole("menuitem", { name: "Open" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { archived: true });
  });

  it("offers Unarchive on an archived row and calls onUpdateItem with archived:false", async () => {
    const rows = await loadRows();
    const archived = rows.map((row) =>
      row.id === "wi_auth" ? { ...row, archived: true } : row,
    );
    const onUpdateItem = makeUpdateMock(archived);
    renderTable({ rows: archived, onUpdateItem });

    await screen.findAllByTestId("work-item-row");

    openRowMenu("Workspace auth hardening");

    fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive" }));
    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { archived: false });
  });

  it("Open from the row actions menu fires onSelectItem", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderTable({ rows, onSelectItem, onUpdateItem: makeUpdateMock(rows) });

    await screen.findAllByTestId("work-item-row");

    openRowMenu("Workspace auth hardening");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open" }));

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: "wi_auth" });
  });

  it("Copy ID writes the row id to the clipboard", async () => {
    const rows = await loadRows();
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    writeText.mockClear();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await screen.findAllByTestId("work-item-row");

    openRowMenu("Workspace auth hardening");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy ID" }));

    expect(writeText).toHaveBeenCalledWith("wi_auth");
  });

  it("exposes a Copy title button on the Name cell that copies the title", async () => {
    const rows = await loadRows();
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    writeText.mockClear();
    renderTable({ rows });

    await screen.findAllByTestId("work-item-row");

    const row = rowByTitle("Workspace auth hardening");
    fireEvent.click(within(row).getByRole("button", { name: "Copy title" }));

    expect(writeText).toHaveBeenCalledWith("Workspace auth hardening");
  });

  it("does not open the row when the actions trigger is clicked", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderTable({ rows, onSelectItem, onUpdateItem: makeUpdateMock(rows) });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Actions for Workspace auth hardening",
      }),
    );
    // Opening the menu must not bubble to a row-open.
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("wires the inline editors as borderless ghost controls showing badges", async () => {
    const rows = await loadRows();
    renderTable({ rows, onUpdateItem: makeUpdateMock(rows) });

    await screen.findAllByTestId("work-item-row");

    // Ghost chrome is forwarded onto the inline select triggers…
    const phase = screen.getByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    expect(phase).toHaveAttribute("data-variant", "ghost");
    // …and the phase value reads as the canonical PhasePill (a data-phase badge)
    // rendered INSIDE the trigger rather than as bare combobox text.
    expect(phase.querySelector("[data-phase]")).not.toBeNull();

    // Type and priority cells likewise show their badges inside ghost triggers.
    expect(
      screen
        .getByRole("combobox", { name: "Type for Workspace auth hardening" })
        .querySelector("[data-type]"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("combobox", { name: "Priority for Workspace auth hardening" })
        .querySelector("[data-priority]"),
    ).not.toBeNull();
  });

  // --- Column-header filters ----------------------------------------------

  /** A Type column filter wired to a spy `onToggle`, with a given selection. */
  function typeColumnFilter(
    selected: ReadonlySet<string> = new Set(),
    onToggle: (value: string) => void = vi.fn(),
  ): ColumnFilter {
    return {
      options: [
        { value: "feature", label: "Feature" },
        { value: "bug", label: "Bug" },
        { value: "chore", label: "Chore" },
        { value: "research", label: "Research" },
      ],
      selected,
      onToggle,
    };
  }

  /** Open a Radix DropdownMenu trigger via the keyboard (the proven jsdom path). */
  function openHeaderFilter(name: string | RegExp): void {
    fireEvent.keyDown(screen.getByRole("button", { name }), { key: "ArrowDown" });
  }

  it("renders a compact filter trigger only in a filterable column header", async () => {
    const rows = await loadRows();
    renderTable({ rows, columnFilters: { type: typeColumnFilter() } });

    await screen.findAllByTestId("work-item-row");

    // The Type column header gets a "Filter Type" trigger…
    expect(
      screen.getByRole("button", { name: "Filter Type" }),
    ).toBeInTheDocument();
    // …while a column without a columnFilters entry (Phase) has none.
    expect(
      screen.queryByRole("button", { name: "Filter Phase" }),
    ).not.toBeInTheDocument();
  });

  it("opens the header filter and lists its options", async () => {
    const rows = await loadRows();
    renderTable({ rows, columnFilters: { type: typeColumnFilter() } });

    await screen.findAllByTestId("work-item-row");

    openHeaderFilter("Filter Type");
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Feature" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Bug" }),
    ).toBeInTheDocument();
  });

  it("surfaces the active count in the header filter's accessible name", async () => {
    const rows = await loadRows();
    renderTable({
      rows,
      columnFilters: { type: typeColumnFilter(new Set(["bug"])) },
    });

    await screen.findAllByTestId("work-item-row");

    expect(
      screen.getByRole("button", { name: "Filter Type (1)" }),
    ).toBeInTheDocument();
  });

  it("toggles a value through the header filter's onToggle", async () => {
    const rows = await loadRows();
    const onToggle = vi.fn();
    renderTable({
      rows,
      columnFilters: { type: typeColumnFilter(new Set(), onToggle) },
    });

    await screen.findAllByTestId("work-item-row");

    openHeaderFilter("Filter Type");
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Bug" }));
    expect(onToggle).toHaveBeenCalledWith("bug");
  });

  // --- Per-group "Select all" ---------------------------------------------

  it("exposes a 'Select all in <label>' checkbox in each group header", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "department" });

    await screen.findAllByTestId("work-item-row");

    // One per swimlane (department grouping → Engineering / Marketing / Sourcing).
    expect(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select all in Marketing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select all in Sourcing" }),
    ).toBeInTheDocument();
    // The group header still surfaces its label + count band.
    const engGroup = screen
      .getAllByTestId("swimlane-group")
      .find((node) => node.dataset.group === "Engineering");
    expect(engGroup).toBeDefined();
    expect(engGroup).toHaveTextContent("Engineering");
    expect(engGroup).toHaveTextContent("4");
  });

  it("renders no per-group checkbox when groupBy is none", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });

    await screen.findAllByTestId("work-item-row");

    // Flat mode short-circuits group headers → no per-group checkbox at all…
    expect(
      screen.queryByRole("checkbox", { name: /^Select all in/ }),
    ).not.toBeInTheDocument();
    // …but the global select-all header checkbox is untouched.
    expect(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    ).toBeInTheDocument();
  });

  it("reads the group checkbox as checked when all its items are selected", async () => {
    const rows = await loadRows();
    renderTable({
      rows,
      groupBy: "department",
      // Every Engineering id selected → its header checkbox reads fully checked.
      selection: new Set([
        "wi_auth",
        "wi_realtime",
        "wi_migration",
        "wi_tabletoken",
      ]),
    });

    await screen.findAllByTestId("work-item-row");

    expect(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    ).toHaveAttribute("aria-checked", "true");
    // A sibling group with nothing selected stays unchecked.
    expect(
      screen.getByRole("checkbox", { name: "Select all in Marketing" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("reads the group checkbox as indeterminate when only some items are selected", async () => {
    const rows = await loadRows();
    // One of Engineering's four ids selected → mixed (partial) state.
    renderTable({
      rows,
      groupBy: "department",
      selection: new Set(["wi_auth"]),
    });

    await screen.findAllByTestId("work-item-row");

    expect(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    ).toHaveAttribute("aria-checked", "mixed");
  });

  it("adds exactly the group's ids (union with prior selection) on an unchecked group click", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    // Prior selection holds a Marketing id OUTSIDE the Engineering group.
    renderTable({
      rows,
      groupBy: "department",
      selection: new Set(["wi_creatives"]),
      onSelectionChange,
    });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    );

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    // Exactly the 4 Engineering ids unioned with the pre-existing Marketing id.
    expect([...next].sort()).toEqual(
      [
        "wi_auth",
        "wi_realtime",
        "wi_migration",
        "wi_tabletoken",
        "wi_creatives",
      ].sort(),
    );
  });

  it("removes exactly the group's ids when the whole group is already selected", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    // All 4 Engineering ids selected (box reads checked) plus an outside id.
    renderTable({
      rows,
      groupBy: "department",
      selection: new Set([
        "wi_auth",
        "wi_realtime",
        "wi_migration",
        "wi_tabletoken",
        "wi_creatives",
      ]),
      onSelectionChange,
    });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    );

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    // The 4 Engineering ids are gone; the outside Marketing id survives intact.
    expect([...next]).toEqual(["wi_creatives"]);
  });

  it("does not mutate the incoming selection set on a group toggle", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    const selection = new Set(["wi_creatives"]);
    renderTable({ rows, groupBy: "department", selection, onSelectionChange });

    await screen.findAllByTestId("work-item-row");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all in Engineering" }),
    );

    // Controlled: the emitted set is a CLONE; the prop set is untouched.
    expect([...selection]).toEqual(["wi_creatives"]);
    expect(onSelectionChange.mock.calls[0][0]).not.toBe(selection);
  });

  // --- Resizable columns --------------------------------------------------

  it("renders a resize handle (separator) on a data column header", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    const handle = await screen.findByRole("separator", {
      name: "Resize Name column",
    });
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    // Seeded from the Name ColumnSpec default (16rem → 256px), floored at 256.
    expect(handle).toHaveAttribute("aria-valuenow", "256");
    expect(handle).toHaveAttribute("aria-valuemin", "256");
    expect(handle).toHaveAttribute("aria-valuemax", "720");
  });

  it("widens a column on ArrowRight and persists the new width", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    const handle = await screen.findByRole("separator", {
      name: "Resize Name column",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    // One +16 step from the 256px default; committed state drives aria-valuenow.
    expect(handle).toHaveAttribute("aria-valuenow", "272");
    expect(window.localStorage.getItem("workboard.table.colw.v1.name")).toBe(
      "272",
    );
  });

  it("clamps a column at its minimum width", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    // Tags has a min (8rem → 128) below its default (10rem → 160), so the floor
    // is observable: Home snaps to the min, then ArrowLeft cannot go below it.
    const handle = await screen.findByRole("separator", {
      name: "Resize Tags column",
    });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "128");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "128");
  });

  it("reset() restores defaults and clears the persisted keys", async () => {
    const rows = await loadRows();
    const resetColumnWidthsRef: { current: (() => void) | null } = {
      current: null,
    };
    renderTable({ rows, resetColumnWidthsRef });

    const handle = await screen.findByRole("separator", {
      name: "Resize Name column",
    });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "272");
    expect(window.localStorage.getItem("workboard.table.colw.v1.name")).toBe(
      "272",
    );

    act(() => {
      resetColumnWidthsRef.current?.();
    });

    expect(handle).toHaveAttribute("aria-valuenow", "256");
    expect(
      window.localStorage.getItem("workboard.table.colw.v1.name"),
    ).toBeNull();
  });

  // --- Grid keyboard navigation (roving tabindex) -------------------------

  /** Every body gridcell (header cells are `columnheader`, not `gridcell`). */
  function gridcells(): HTMLElement[] {
    return screen.getAllByRole("gridcell");
  }
  /** The gridcells currently in the tab order (roving → expected to be one). */
  function tabbableGridcells(): HTMLElement[] {
    return gridcells().filter((c) => c.getAttribute("tabindex") === "0");
  }
  /** The single active (tabbable) gridcell; throws if not exactly one. */
  function activeGridcell(): HTMLElement {
    const tabbable = tabbableGridcells();
    expect(tabbable).toHaveLength(1);
    return tabbable[0];
  }
  /** The active cell's coordinate: row index lives on the row, col on the cell. */
  function activeCoord(): { row: string | null; col: string | null } {
    const cell = activeGridcell();
    return {
      row: cell.closest('[role="row"]')?.getAttribute("aria-rowindex") ?? null,
      col: cell.getAttribute("aria-colindex"),
    };
  }
  /** Press a key on whichever cell currently holds the roving tab stop. */
  function pressOnActive(key: string, init: object = {}): void {
    fireEvent.keyDown(activeGridcell(), { key, ...init });
  }

  it("starts with exactly one tabbable gridcell at the first data cell", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // Roving tabindex: precisely one cell is in the tab order on mount — the
    // first data row's first navigable column (the selection cell, aria-colindex
    // 1, aria-rowindex 2 after the header row at index 1).
    expect(activeCoord()).toEqual({ row: "2", col: "1" });
    // Every other gridcell is removed from the tab order.
    for (const cell of gridcells()) {
      if (cell !== activeGridcell()) {
        expect(cell).toHaveAttribute("tabindex", "-1");
      }
    }
  });

  it("moves the roving tab stop to a focused cell", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // Focusing a different cell makes it the sole tabbable one (focus follows).
    const target = gridcells().find(
      (c) =>
        c.closest('[role="row"]')?.getAttribute("aria-rowindex") === "3" &&
        c.getAttribute("aria-colindex") === "4",
    );
    if (!target) throw new Error("target cell missing");
    fireEvent.focus(target);

    expect(tabbableGridcells()).toEqual([target]);
  });

  it("ArrowRight/ArrowLeft move one column and clamp at the row's ends", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // ArrowLeft at the first column clamps (no wrap).
    pressOnActive("ArrowLeft");
    expect(activeCoord().col).toBe("1");
    // ArrowRight advances one column.
    pressOnActive("ArrowRight");
    expect(activeCoord().col).toBe("2");
    pressOnActive("ArrowRight");
    expect(activeCoord().col).toBe("3");
  });

  it("End/Home jump to the row's last/first cell and ArrowRight clamps at the end", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // No mutator → no actions column, so the last navigable col is selection (1)
    // + 8 data columns = aria-colindex 9.
    pressOnActive("End");
    expect(activeCoord().col).toBe("9");
    pressOnActive("ArrowRight");
    expect(activeCoord().col).toBe("9");
    pressOnActive("Home");
    expect(activeCoord().col).toBe("1");
  });

  it("ArrowDown/ArrowUp move one row, preserve the column, and clamp at the top", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // ArrowUp at the top row clamps.
    pressOnActive("ArrowUp");
    expect(activeCoord().row).toBe("2");
    // Move to column 2, then ArrowDown carries the column to the next row.
    pressOnActive("ArrowRight");
    pressOnActive("ArrowDown");
    expect(activeCoord()).toEqual({ row: "3", col: "2" });
    // DOM focus actually FOLLOWS the active coordinate — the virtualization-aware
    // layout effect moved focus to the destination cell, not just its tabindex.
    expect(document.activeElement).toBe(activeGridcell());
  });

  it("Ctrl+End and Ctrl+Home jump to the grid's last and first navigable cell", async () => {
    const rows = await loadRows(); // 10 items, flat → aria-rowindex 2..11
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    pressOnActive("End", { ctrlKey: true });
    expect(activeCoord()).toEqual({ row: "11", col: "9" });
    pressOnActive("Home", { ctrlKey: true });
    expect(activeCoord()).toEqual({ row: "2", col: "1" });
  });

  it("collapses the column to the group header's checkbox when moving onto a group row", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "department" });
    await screen.findAllByTestId("work-item-row");

    // First cell is the first swimlane header's col-1 (its select-all checkbox).
    expect(activeCoord()).toEqual({ row: "2", col: "1" });
    // Down onto the first item, then right to a data column.
    pressOnActive("ArrowDown");
    expect(activeCoord().row).toBe("3");
    for (let i = 0; i < 4; i += 1) pressOnActive("ArrowRight");
    expect(activeCoord().col).toBe("5");
    // Up onto the group header collapses the column back to 1 (the checkbox).
    pressOnActive("ArrowUp");
    expect(activeCoord()).toEqual({ row: "2", col: "1" });
  });

  it("Enter on the selection cell toggles the row via its checkbox", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    renderTable({ rows, groupBy: "none", onSelectionChange });
    await screen.findAllByTestId("work-item-row");

    // The initial active cell IS the first row's selection cell (col 1); Enter
    // activates its primary control (the checkbox) → a controlled toggle.
    pressOnActive("Enter");
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0][0]]).toEqual([rows[0].id]);
  });

  it("Enter on the Name cell opens the row via its title button", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderTable({ rows, groupBy: "none", onSelectItem });
    await screen.findAllByTestId("work-item-row");

    pressOnActive("ArrowRight"); // → Name column (col 2)
    expect(activeCoord().col).toBe("2");
    pressOnActive("Enter");
    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: rows[0].id });
  });

  it("Space on an editable cell focuses its inline control", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none", onUpdateItem: makeUpdateMock(rows) });
    await screen.findAllByTestId("work-item-row");

    // Navigate to the Phase column (selection 1 · name 2 · type 3 · phase 4).
    pressOnActive("ArrowRight");
    pressOnActive("ArrowRight");
    pressOnActive("ArrowRight");
    expect(activeCoord().col).toBe("4");
    pressOnActive(" ");
    // Activation moved focus into the cell's inline combobox (the editor).
    const combobox = within(activeGridcell()).getByRole("combobox");
    expect(document.activeElement).toBe(combobox);
  });

  it("Escape from inside a cell returns focus to the owning gridcell", async () => {
    const rows = await loadRows();
    renderTable({ rows, groupBy: "none" });
    await screen.findAllByTestId("work-item-row");

    // The Name title button stands in for an inner editor/control.
    const titleButton = screen.getByRole("button", {
      name: "Workspace auth hardening",
    });
    const cell = titleButton.closest('[role="gridcell"]');
    titleButton.focus();
    expect(document.activeElement).toBe(titleButton);

    fireEvent.keyDown(titleButton, { key: "Escape" });
    // Focus returns to the gridcell so arrow navigation resumes.
    expect(document.activeElement).toBe(cell);
  });

  it("keeps the resize-handle keyboard and shift-click range-select working with cell nav active", async () => {
    const rows = await loadRows();
    const onSelectionChange = vi.fn();
    renderTable({ rows, groupBy: "none", onSelectionChange });
    const rowEls = await screen.findAllByTestId("work-item-row");

    // Drive some cell navigation first so the roving state is engaged.
    pressOnActive("ArrowDown");
    pressOnActive("ArrowRight");

    // The resize handle is a SEPARATE tab stop (role=separator) and still
    // commits a keyboard width change — cell nav never hijacked it.
    const handle = screen.getByRole("separator", { name: "Resize Name column" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "272");

    // Shift-click range-select (anchorIdRef) still unions the inclusive range.
    const checkboxOf = (el: HTMLElement): HTMLElement =>
      within(el).getByRole("checkbox");
    fireEvent.click(checkboxOf(rowEls[0]));
    onSelectionChange.mockClear();
    fireEvent.click(checkboxOf(rowEls[2]), { shiftKey: true });
    const next = onSelectionChange.mock.calls[0][0] as Set<string>;
    expect(next.size).toBe(3);
  });
});
