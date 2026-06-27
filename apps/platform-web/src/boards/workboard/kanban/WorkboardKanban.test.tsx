import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
} from "@product-suite/ui";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMockWorkItemRepository,
  createOwnerFixtures,
  deriveHealth,
  type Task,
  type WorkItem,
  type WorkItemPatch,
  type WorkItemRow,
} from "@/data/work-items";

import {
  WorkboardKanban,
  type WorkboardKanbanProps,
  encodeColumnId,
  resolveDrop,
  resolvePhaseChange,
} from "./WorkboardKanban";

/**
 * Radix Tooltip (used behind each card's ProvenanceChip) and dnd-kit's keyboard
 * sensor both reach for Pointer-Capture / `scrollIntoView` APIs jsdom omits.
 * We shim them here (the shared test/setup.ts is out of this dir's ownership).
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

/**
 * Build real fixture-backed rows via the seam so health/counts are realistic and
 * every phase column is populated. Mirrors the table test's `loadRows`.
 */
async function loadRows(): Promise<WorkItemRow[]> {
  const repository = createMockWorkItemRepository();
  const [items, tasks] = await Promise.all([
    repository.list(),
    repository.listTasks(),
  ]);
  const now = Date.parse("2026-06-20T00:00:00.000Z");
  return items.map((item: WorkItem): WorkItemRow => {
    const itemTasks = tasks.filter((task: Task) => task.work_item_id === item.id);
    const completedTaskCount = itemTasks.filter(
      (task) => task.status === "completed",
    ).length;
    return {
      ...item,
      health: deriveHealth(item, itemTasks, now),
      taskCount: itemTasks.length,
      completedTaskCount,
    };
  });
}

/** Render with sane defaults for every REQUIRED prop, overridable per test. */
function renderKanban(overrides: Partial<WorkboardKanbanProps> = {}) {
  const props: WorkboardKanbanProps = {
    rows: [],
    owners: createOwnerFixtures(),
    loading: false,
    error: null,
    onSelectItem: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkboardKanban {...props} />) };
}

describe("resolvePhaseChange", () => {
  it("returns the target phase when the column actually changed", () => {
    expect(resolvePhaseChange("plan", "done")).toBe("done");
    expect(resolvePhaseChange("review", "execute")).toBe("execute");
  });

  it("returns null for a same-column drop (no redundant patch)", () => {
    expect(resolvePhaseChange("execute", "execute")).toBeNull();
  });

  it("returns null when there is no / an unknown drop target", () => {
    expect(resolvePhaseChange("plan", null)).toBeNull();
    expect(resolvePhaseChange("plan", "archived")).toBeNull();
  });
});

describe("resolveDrop", () => {
  it("returns the field-scoped patch when the column changed (per dimension)", () => {
    // Each dimension patches ITS OWN key with the dropped column's value.
    expect(resolveDrop("phase", "plan", encodeColumnId("phase", "done"))).toEqual(
      { phase: "done" },
    );
    expect(
      resolveDrop("priority", "low", encodeColumnId("priority", "high")),
    ).toEqual({ priority: "high" });
    expect(resolveDrop("type", "feature", encodeColumnId("type", "bug"))).toEqual(
      { type: "bug" },
    );
    expect(
      resolveDrop(
        "department",
        "Engineering",
        encodeColumnId("department", "Marketing"),
      ),
    ).toEqual({ department: "Marketing" });
  });

  it("returns null for a same-column drop (no redundant patch)", () => {
    expect(
      resolveDrop("priority", "high", encodeColumnId("priority", "high")),
    ).toBeNull();
  });

  it("returns null when there is no drop target", () => {
    expect(resolveDrop("type", "feature", null)).toBeNull();
  });

  it("ignores a drop whose encoded field differs from the board's", () => {
    // Encoding the field into the droppable id means a stray id from another
    // dimension can never collide with this board's column values.
    expect(
      resolveDrop("priority", "high", encodeColumnId("phase", "done")),
    ).toBeNull();
  });

  it("patches an empty department when dropped on the Unassigned column", () => {
    expect(
      resolveDrop("department", "Engineering", encodeColumnId("department", "")),
    ).toEqual({ department: "" });
  });
});

describe("WorkboardKanban", () => {
  it("renders a skeleton while loading", () => {
    renderKanban({ loading: true });
    const skeleton = screen.getByTestId("workboard-kanban-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveAttribute("role", "status");
  });

  it("renders an error state with a retry path", () => {
    const onRetry = vi.fn();
    renderKanban({ error: new Error("boom"), onRetry });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state when there are no rows", () => {
    renderKanban({ rows: [] });
    expect(screen.getByText("No work items")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-column")).not.toBeInTheDocument();
  });

  it("renders the four phase columns in canonical order", async () => {
    const rows = await loadRows();
    renderKanban({ rows });

    const columns = await screen.findAllByTestId("kanban-column");
    expect(columns.map((node) => node.dataset.phase)).toEqual([
      "plan",
      "execute",
      "review",
      "done",
    ]);
    // Headers carry the human PHASE_LABELS.
    expect(within(columns[0]).getByText("Plan")).toBeInTheDocument();
    expect(within(columns[3]).getByText("Done")).toBeInTheDocument();
  });

  it("shows a per-column count badge equal to that column's card count", async () => {
    const rows = await loadRows();
    renderKanban({ rows });

    const columns = await screen.findAllByTestId("kanban-column");
    for (const column of columns) {
      const phase = column.dataset.phase;
      const expected = rows.filter((row) => row.phase === phase).length;
      const count = within(column).getByTestId("kanban-column-count");
      expect(count).toHaveTextContent(String(expected));
      // The card DOM count matches the badge.
      expect(within(column).queryAllByTestId("kanban-card")).toHaveLength(
        expected,
      );
    }
  });

  it("places each card in the column matching its phase", async () => {
    const rows = await loadRows();
    renderKanban({ rows });

    await screen.findAllByTestId("kanban-card");

    // wi_auth is `execute`; assert its card lives under the Execute column.
    const executeColumn = screen
      .getAllByTestId("kanban-column")
      .find((node) => node.dataset.phase === "execute");
    expect(executeColumn).toBeDefined();
    expect(
      within(executeColumn as HTMLElement).getByText("Workspace auth hardening"),
    ).toBeInTheDocument();
  });

  it("shows a 'No items' placeholder for an empty column", async () => {
    // A single `plan` row leaves execute/review/done empty.
    const rows = (await loadRows()).filter((row) => row.phase === "plan").slice(0, 1);
    renderKanban({ rows });

    await screen.findAllByTestId("kanban-card");
    const placeholders = screen.getAllByTestId("kanban-column-empty");
    // Exactly three of the four columns are empty.
    expect(placeholders).toHaveLength(3);
    expect(placeholders[0]).toHaveTextContent("No items");
  });

  it("fires onSelectItem when a card is clicked", async () => {
    const rows = await loadRows();
    const onSelectItem = vi.fn();
    renderKanban({ rows, onSelectItem });

    const card = await screen.findByLabelText("Open Workspace auth hardening");
    fireEvent.click(card);

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: "wi_auth" });
  });

  it("resolves the owner avatar + name, falling back to Unassigned", async () => {
    const rows = await loadRows();
    renderKanban({ rows });

    await screen.findAllByTestId("kanban-card");
    // wi_auth → Amara Okafor (resolved owner); Amara owns >1 item, so match all.
    expect(screen.getAllByText("Amara Okafor").length).toBeGreaterThan(0);
    // wi_landing has assignee_id: null (department queue) → "Unassigned".
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
  });

  it("de-emphasizes an archived card and shows an Archived indicator", async () => {
    const rows = (await loadRows()).map((row) =>
      row.id === "wi_auth" ? { ...row, archived: true } : row,
    );
    renderKanban({ rows });

    const card = await screen.findByLabelText("Open Workspace auth hardening");
    expect(card.className).toContain("opacity-60");
    expect(card).toHaveAttribute("data-archived", "true");
    expect(
      within(card).getByTestId("kanban-archived-indicator"),
    ).toHaveTextContent("Archived");
  });

  it("makes cards draggable only when a mutator is wired", async () => {
    const rows = await loadRows();
    const onUpdateItem = vi
      .fn<(id: string, patch: WorkItemPatch) => Promise<WorkItem>>()
      .mockResolvedValue(rows[0]);
    const { rerender } = renderKanban({ rows, onUpdateItem });

    // With a mutator, the DndContext wraps the board (cards expose a role attr).
    const draggableCard = await screen.findByLabelText(
      "Open Workspace auth hardening",
    );
    expect(draggableCard).toHaveAttribute("role", "button");

    // Read-only: re-render without the mutator; the board still renders cards.
    rerender(
      <WorkboardKanban
        rows={rows}
        owners={createOwnerFixtures()}
        loading={false}
        error={null}
        onSelectItem={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByLabelText("Open Workspace auth hardening"),
      ).toBeInTheDocument();
    });
  });

  it("pivots to a Priority board when grouped by priority", async () => {
    const rows = await loadRows();
    renderKanban({ rows, groupBy: "priority" });

    const columns = await screen.findAllByTestId("kanban-column");
    // Columns follow the canonical PRIORITY_ORDER (critical → low).
    expect(columns.map((node) => node.dataset.columnValue)).toEqual([
      ...PRIORITY_ORDER,
    ]);
    // Header is the priority LABEL (heading role, so a card's PriorityBadge text
    // inside the column does not steal the match).
    expect(
      within(columns[0]).getByRole("heading", {
        name: PRIORITY_LABELS.critical,
      }),
    ).toBeInTheDocument();
    // Each column's count equals the rows carrying that priority.
    for (const column of columns) {
      const value = column.dataset.columnValue;
      const expected = rows.filter((row) => row.priority === value).length;
      expect(within(column).getByTestId("kanban-column-count")).toHaveTextContent(
        String(expected),
      );
    }
  });

  it("pivots to a Type board when grouped by type", async () => {
    const rows = await loadRows();
    renderKanban({ rows, groupBy: "type" });

    const columns = await screen.findAllByTestId("kanban-column");
    expect(columns.map((node) => node.dataset.columnValue)).toEqual([
      ...WORK_ITEM_TYPE_ORDER,
    ]);
    expect(
      within(columns[0]).getByRole("heading", {
        name: WORK_ITEM_TYPE_LABELS.feature,
      }),
    ).toBeInTheDocument();
    // Enum columns render even when populated by a single row.
    const bugColumn = columns.find((node) => node.dataset.columnValue === "bug");
    expect(bugColumn).toBeDefined();
    expect(
      within(bugColumn as HTMLElement).getByTestId("kanban-column-count"),
    ).toHaveTextContent("1");
  });

  it("pivots to a Department board with one column per present department", async () => {
    const rows = await loadRows();
    renderKanban({ rows, groupBy: "department" });

    const columns = await screen.findAllByTestId("kanban-column");
    // Present departments only (dynamic), sorted alphabetically.
    expect(columns.map((node) => node.dataset.columnValue)).toEqual([
      "Engineering",
      "Marketing",
      "Sourcing",
    ]);
    expect(
      within(columns[0]).getByRole("heading", { name: "Engineering" }),
    ).toBeInTheDocument();
    for (const column of columns) {
      const value = column.dataset.columnValue;
      const expected = rows.filter((row) => row.department === value).length;
      expect(within(column).getByTestId("kanban-column-count")).toHaveTextContent(
        String(expected),
      );
    }
  });

  it("buckets rows with no department into a trailing Unassigned column", async () => {
    // Empty the department on one row → it falls into the Unassigned bucket.
    const rows = (await loadRows()).map((row) =>
      row.id === "wi_auth" ? { ...row, department: "" } : row,
    );
    renderKanban({ rows, groupBy: "department" });

    const columns = await screen.findAllByTestId("kanban-column");
    const values = columns.map((node) => node.dataset.columnValue);
    // Unassigned ("") is appended AFTER the named, present departments.
    expect(values[values.length - 1]).toBe("");
    const unassigned = columns[columns.length - 1];
    expect(
      within(unassigned).getByRole("heading", { name: "Unassigned" }),
    ).toBeInTheDocument();
    expect(
      within(unassigned).getByText("Workspace auth hardening"),
    ).toBeInTheDocument();
  });

  it("falls back to a phase board when groupBy is none", async () => {
    const rows = await loadRows();
    renderKanban({ rows, groupBy: "none" });

    const columns = await screen.findAllByTestId("kanban-column");
    expect(columns.map((node) => node.dataset.phase)).toEqual([
      "plan",
      "execute",
      "review",
      "done",
    ]);
  });

  it("renders a read-only non-phase board without a mutator", async () => {
    const rows = await loadRows();
    // No onUpdateItem → read-only, but the pivot still renders every column.
    renderKanban({ rows, groupBy: "priority" });

    const cards = await screen.findAllByTestId("kanban-card");
    expect(cards).toHaveLength(rows.length);
    const columns = screen.getAllByTestId("kanban-column");
    expect(columns.map((node) => node.dataset.columnValue)).toEqual([
      ...PRIORITY_ORDER,
    ]);
  });
});
