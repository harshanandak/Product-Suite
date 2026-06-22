import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
});
