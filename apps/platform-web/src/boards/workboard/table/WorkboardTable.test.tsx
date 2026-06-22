import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import { WorkboardTable, type WorkItemTableProps } from "./WorkboardTable";

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

  it("exposes explicit table roles for assistive tech", async () => {
    const rows = await loadRows();
    renderTable({ rows });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    const table = screen.getByRole("table", { name: "Work items" });
    // Selection column + all 8 data columns.
    expect(table).toHaveAttribute("aria-colcount", String(1 + COLUMN_IDS.length));
    // One columnheader per visible data column plus the leading selection header.
    expect(screen.getAllByRole("columnheader").length).toBe(1 + COLUMN_IDS.length);
    // Every row carries an explicit role despite the flex/absolute overrides.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
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
    // wi_auth's due_date 2026-07-10 surfaces as the sliced ISO date somewhere.
    expect(screen.getByText("2026-07-10")).toBeInTheDocument();
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
      screen.getByRole("table", { name: "Work items" }),
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

  /**
   * Open a row's "⋯" actions DropdownMenu. Radix opens its trigger on the
   * pointerdown sequence (absent in jsdom) but also on keyboard activation, so
   * we focus the trigger and press Enter — mirroring the `selectOption` pattern.
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
      throw new Error(`No row found for "${title}"`);
    }
    return row;
  }

  it("de-emphasizes an archived row and shows an Archived indicator", async () => {
    const rows = await loadRows();
    // Fixtures seed only active items; mark one archived by hand.
    const archived = rows.map((row) =>
      row.id === "wi_auth" ? { ...row, archived: true } : row,
    );
    renderTable({ rows: archived });

    await screen.findAllByTestId("work-item-row");

    const row = rowByTitle("Workspace auth hardening");
    // Muted + dimmed styling marks the row as de-emphasized.
    expect(row).toHaveClass("text-muted-foreground");
    expect(row).toHaveClass("opacity-60");
    expect(row).toHaveAttribute("data-archived", "true");
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
});
