import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMockWorkItemRepository,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkboardTable } from "./WorkboardTable";

/**
 * jsdom has no layout engine, so @tanstack/react-virtual sees a zero-height
 * scroll element and renders no rows. Its `getRect` reads `element.offsetWidth`
 * / `element.offsetHeight` (verified in virtual-core's source) — NOT
 * `getBoundingClientRect` — and `ResizeObserver` is undefined. We stub both so
 * the virtualizer believes it has a 600px viewport.
 *
 * Radix Select (which backs the shared `PhaseSelect`) additionally needs the
 * Pointer-Capture and `scrollIntoView` APIs that jsdom omits; without these the
 * listbox never opens. Both groups of shims are scoped to this file (the shared
 * test/setup.ts is out of this dir's ownership).
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
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
function selectPhaseOption(combobox: HTMLElement, optionName: string): void {
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
 * A `vi.fn` phase-update mock resolving the optimistically-patched row (the shape
 * the table expects back). Shared by the inline- and bulk-edit tests.
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

describe("WorkboardTable", () => {
  it("renders a skeleton while loading", () => {
    render(
      <WorkboardTable
        items={[]}
        loading
        error={null}
        onSelectItem={vi.fn()}
      />,
    );
    const skeleton = screen.getByTestId("workboard-table-skeleton");
    expect(skeleton).toBeInTheDocument();
    // a11y: the load is announced as a busy status region.
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveAttribute("role", "status");
  });

  it("renders an error state with a retry path", () => {
    const onRetry = vi.fn();
    render(
      <WorkboardTable
        items={[]}
        loading={false}
        error={new Error("boom")}
        onRetry={onRetry}
        onSelectItem={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("exposes explicit table roles for assistive tech", async () => {
    const rows = await loadRows();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    const table = screen.getByRole("table", { name: "Work items" });
    expect(table).toHaveAttribute("aria-colcount", "5");
    // Column headers are announced (one per declared column).
    expect(screen.getAllByRole("columnheader").length).toBe(5);
    // Every row carries an explicit role despite the flex/absolute overrides.
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
  });

  it("renders rows with phase pills and department swimlanes", async () => {
    const rows = await loadRows();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Department swimlane headers render (group-by-department).
    expect(screen.getAllByTestId("department-group").length).toBeGreaterThan(0);

    // A known fixture title is shown.
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();

    // PhasePill renders for displayed items (data-phase attribute from the pill).
    const pills = document.querySelectorAll("[data-phase]");
    expect(pills.length).toBeGreaterThan(0);
  });

  it("fires onSelectItem when a row title is clicked", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={onSelectItem}
      />,
    );

    const titleButton = await screen.findByRole("button", {
      name: "Workspace auth hardening",
    });
    fireEvent.click(titleButton);

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({
      id: "wi_auth",
    });
  });

  it("calls onUpdateItem when the inline phase select changes", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);

    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
        onUpdateItem={onUpdateItem}
      />,
    );

    const combobox = await screen.findByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    selectPhaseOption(combobox, "Done");

    expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { phase: "done" });
  });

  it("does not fire onSelectItem when the inline phase select changes", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={onSelectItem}
        onUpdateItem={vi.fn().mockResolvedValue(rows[0])}
      />,
    );

    const combobox = await screen.findByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    selectPhaseOption(combobox, "Review");

    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it("applies a bulk phase change to selected rows", async () => {
    const rows = await loadRows();
    const onUpdateItem = makeUpdateMock(rows);

    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
        onUpdateItem={onUpdateItem}
      />,
    );

    await screen.findAllByTestId("work-item-row");

    // Select one row via the new Checkbox primitive.
    const rowCheckbox = screen.getByRole("checkbox", {
      name: "Select Workspace auth hardening",
    });
    fireEvent.click(rowCheckbox);

    // Choose a bulk phase and apply.
    const bulkCombobox = screen.getByRole("combobox", { name: "Bulk phase" });
    selectPhaseOption(bulkCombobox, "Review");
    fireEvent.click(screen.getByRole("button", { name: /apply phase/i }));

    await waitFor(() => {
      expect(onUpdateItem).toHaveBeenCalledWith("wi_auth", { phase: "review" });
    });
  });

  it("reflects a partial selection as an indeterminate select-all checkbox", async () => {
    const rows = await loadRows();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
        onUpdateItem={vi.fn().mockResolvedValue(rows[0])}
      />,
    );

    await screen.findAllByTestId("work-item-row");

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all work items",
    });
    // Nothing selected → unchecked.
    expect(selectAll).toHaveAttribute("aria-checked", "false");

    // Select a single row → header goes tri-state (mixed).
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );
    expect(selectAll).toHaveAttribute("aria-checked", "mixed");
  });

  it("does not render selection or inline controls without a mutator", async () => {
    const rows = await loadRows();
    render(
      <WorkboardTable
        items={rows}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
      />,
    );

    await screen.findAllByTestId("work-item-row");

    // No checkboxes and no editable phase comboboxes in read-only mode.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The read-only phase still renders as a pill.
    const firstRow = screen.getAllByTestId("work-item-row")[0];
    expect(within(firstRow).getByText(/plan|execute|review|done/i)).toBeTruthy();
  });
});
