import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createMockWorkItemRepository,
  createOwnerFixtures,
  deriveHealth,
  type Task,
  type WorkItem,
  type WorkItemDependency,
  type WorkItemPatch,
  type WorkItemRow,
} from "@/data/work-items";

import { WorkboardGraph, type WorkboardGraphProps } from "./WorkboardGraph";

/**
 * Component coverage for the Graph view (DESIGN §5 jsdom strategy: the BULK of
 * behaviour is in `layout.test.ts` — pure helpers without React Flow; here we
 * assert parity (node click → onSelectItem), the layout-mode toggle, and the
 * loading/error/empty/read-only states).
 *
 * React Flow needs `ResizeObserver` + real element dimensions jsdom lacks (and
 * `onlyRenderVisibleElements` mounts NOTHING in a zero-size viewport). We shim
 * `ResizeObserver`, give every element a non-zero `getBoundingClientRect`, and
 * shim the Pointer-Capture / `scrollIntoView` APIs Radix/React Flow reach for —
 * the shared test/setup.ts is out of this dir's ownership.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};

  // React Flow measures the flow wrapper + each node via ResizeObserver and
  // getBoundingClientRect; jsdom reports 0×0, which culls every node. Force a
  // real size so the viewport is non-zero and nodes mount.
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??=
    ResizeObserverStub as unknown as typeof ResizeObserver;

  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterAll(() => {
  vi.restoreAllMocks();
});

/** Build real fixture-backed rows via the seam (mirrors the Kanban test). */
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

/** Load the seam's dependency fixtures (the FULL set the view validates against). */
async function loadDependencies(): Promise<WorkItemDependency[]> {
  return createMockWorkItemRepository().listDependencies();
}

/** Render with sane defaults for every REQUIRED prop, overridable per test. */
function renderGraph(overrides: Partial<WorkboardGraphProps> = {}) {
  const props: WorkboardGraphProps = {
    rows: [],
    dependencies: [],
    owners: createOwnerFixtures(),
    loading: false,
    error: null,
    onSelectItem: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<WorkboardGraph {...props} />) };
}

describe("WorkboardGraph", () => {
  it("renders a skeleton while loading", () => {
    renderGraph({ loading: true });
    const skeleton = screen.getByTestId("workboard-graph-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveAttribute("role", "status");
  });

  it("renders an error state with a retry path", () => {
    const onRetry = vi.fn();
    renderGraph({ error: new Error("boom"), onRetry });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an empty state when there are no rows", () => {
    renderGraph({ rows: [] });
    expect(screen.getByText("No work items")).toBeInTheDocument();
    expect(screen.queryByTestId("workboard-graph")).not.toBeInTheDocument();
  });

  it("renders the layout-mode toggle and the auto-layout button", async () => {
    const rows = await loadRows();
    const dependencies = await loadDependencies();
    renderGraph({ rows, dependencies });

    expect(
      await screen.findByRole("tab", { name: "Dependencies" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Phase" })).toBeInTheDocument();
    expect(screen.getByTestId("graph-auto-layout")).toBeInTheDocument();
  });

  it("switches to Phase mode and renders the four swimlanes", async () => {
    const rows = await loadRows();
    const dependencies = await loadDependencies();
    renderGraph({ rows, dependencies });

    // Radix Tabs activate on pointer/mouse-down (a bare click does not flip the
    // selection in jsdom), so drive the toggle via mouseDown.
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Phase" }));

    await waitFor(() => {
      expect(screen.getAllByTestId("graph-phase-lane")).toHaveLength(4);
    });
    const lanes = screen.getAllByTestId("graph-phase-lane");
    expect(lanes.map((node) => node.dataset.phase)).toEqual([
      "plan",
      "execute",
      "review",
      "done",
    ]);
  });

  it("fires onSelectItem when a node title is clicked (editor parity)", async () => {
    const rows = await loadRows();
    const dependencies = await loadDependencies();
    const onSelectItem = vi.fn();
    renderGraph({ rows, dependencies, onSelectItem });

    const open = await screen.findByLabelText("Open Workspace auth hardening");
    fireEvent.click(open);

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: "wi_auth" });
  });

  it("shows the inline phase pill (editable) when a mutator is wired", async () => {
    const rows = await loadRows();
    const dependencies = await loadDependencies();
    const onUpdateItem = vi
      .fn<(id: string, patch: WorkItemPatch) => Promise<WorkItem>>()
      .mockResolvedValue(rows[0]);
    renderGraph({ rows, dependencies, onUpdateItem });

    // The editable PhaseSelect exposes an aria-labelled combobox per node.
    expect(
      await screen.findByLabelText("Phase for Workspace auth hardening"),
    ).toBeInTheDocument();
  });

  it("is read-only when no mutators are wired (no editable phase control)", async () => {
    const rows = await loadRows();
    const dependencies = await loadDependencies();
    renderGraph({ rows, dependencies });

    // A node still renders, but the phase control falls back to a read-only pill.
    await screen.findByLabelText("Open Workspace auth hardening");
    expect(
      screen.queryByLabelText("Phase for Workspace auth hardening"),
    ).not.toBeInTheDocument();
  });

  it("renders only edges whose both endpoints are visible", async () => {
    const allRows = await loadRows();
    const dependencies = await loadDependencies();
    // Keep a single row → every dependency now has at least one hidden endpoint,
    // so NO edge should render (DESIGN §5 visible-edge filter).
    const rows = allRows.slice(0, 1);
    const { container } = renderGraph({ rows, dependencies });

    await screen.findByTestId("graph-node");
    await waitFor(() => {
      expect(
        container.querySelectorAll(".react-flow__edge").length,
      ).toBe(0);
    });
  });
});
