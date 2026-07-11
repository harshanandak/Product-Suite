import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeTypes,
} from "@xyflow/react";

import { TooltipProvider } from "@product-suite/ui";

import { createOwnerFixtures, type WorkItemRow } from "@/data/work-items";

import { WorkItemNode, type WorkItemNodeData } from "./WorkItemNode";

/**
 * WorkItemNode renders React Flow `Handle`s, which need the flow context — so it
 * is exercised inside a minimal `<ReactFlow>` (one node). React Flow needs
 * ResizeObserver + real element dimensions jsdom lacks; shim them.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};

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

/** React Flow mounts slower than `findBy`'s 1000ms default under load. */
const SLOW = { timeout: 10000 } as const;

const NODE_TYPES: NodeTypes = { workItem: WorkItemNode };

const ROW: WorkItemRow = {
  id: "wi_x",
  title: "Test item",
  phase: "execute",
  type: "feature",
  priority: "high",
  tags: ["t1"],
  source: "manual",
  project_id: null,
  team_id: "team_engineering",
  status_id: "status_engineering_execute",
  department: "Engineering",
  assignee_id: "user_amara",
  due_date: "2026-07-10T00:00:00.000Z",
  archived: false,
  created_at: "2026-05-01T09:00:00.000Z",
  updated_at: "2026-06-19T09:00:00.000Z",
  health: "on_track",
  taskCount: 0,
  completedTaskCount: 0,
};

/** Render WorkItemNode as the single node of a minimal flow. */
function renderNode(data: Partial<WorkItemNodeData> = {}) {
  const full: WorkItemNodeData = {
    row: ROW,
    owners: createOwnerFixtures(),
    connectable: true,
    onSelectItem: vi.fn(),
    ...data,
  };
  const nodes: Node<WorkItemNodeData, "workItem">[] = [
    { id: ROW.id, type: "workItem", position: { x: 0, y: 0 }, data: full },
  ];
  render(
    <TooltipProvider>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <ReactFlow nodes={nodes} edges={[]} nodeTypes={NODE_TYPES} fitView />
        </div>
      </ReactFlowProvider>
    </TooltipProvider>,
  );
  return full;
}

describe("WorkItemNode", () => {
  it("renders the work-item card with its title", async () => {
    renderNode();
    expect(
      await screen.findByTestId("graph-node", undefined, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Open Test item")).toBeInTheDocument();
  });

  it("opens the editor when the title is clicked (action parity)", async () => {
    const onSelectItem = vi.fn();
    renderNode({ onSelectItem });
    fireEvent.click(
      await screen.findByLabelText("Open Test item", undefined, SLOW),
    );
    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem.mock.calls[0][0]).toMatchObject({ id: "wi_x" });
  });

  it("shows an editable phase pill when a mutator is wired", async () => {
    renderNode({
      onUpdateItem: vi.fn().mockResolvedValue(undefined),
    });
    await screen.findByTestId("graph-node", undefined, SLOW);
    expect(screen.getByLabelText("Phase for Test item")).toBeInTheDocument();
  });

  it("falls back to a read-only phase pill with no mutator", async () => {
    renderNode({ onUpdateItem: undefined });
    await screen.findByTestId("graph-node", undefined, SLOW);
    expect(
      screen.queryByLabelText("Phase for Test item"),
    ).not.toBeInTheDocument();
  });
});
