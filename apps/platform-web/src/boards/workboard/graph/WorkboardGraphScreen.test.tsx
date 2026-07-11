import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "@/data/work-items";

// Node activation now navigates to the detail route. Mock the router so the
// screen's useNavigate/useParams resolve without a RouterProvider, and capture
// the navigate call. The real TanStack `navigate` returns a Promise the screen
// calls `.catch(...)` on, so the mock must resolve to keep that chain valid.
const navMock = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve()) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navMock.fn,
  useParams: () => ({ workspace: "acme" }),
}));

import { WorkboardGraphScreen } from "./WorkboardGraphScreen";

/**
 * Screen-level coverage for the full-page Graph sub-board. The graph itself is
 * exhaustively tested in WorkboardGraph.test.tsx + layout/gestures specs; here we
 * assert the SCREEN integration: the lazy graph mounts, a node click opens the
 * SAME editor (action parity), and a load error surfaces through the graph.
 *
 * React Flow needs ResizeObserver + real element dimensions jsdom lacks, and the
 * editor's Radix sheet reaches for Pointer-Capture / scrollIntoView — shim both.
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

/**
 * The screen lazy-loads the graph chunk and mounts React Flow in jsdom — slower
 * than `findBy`'s 1000ms default under load. Wait generously (well within the
 * 15s test timeout) so the integration assertions are not flaky.
 */
const SLOW_FIND = { timeout: 10000 } as const;

describe("WorkboardGraphScreen", () => {
  it("renders the full-page graph (own sub-board, no page-header chrome)", async () => {
    render(<WorkboardGraphScreen repository={createMockWorkItemRepository()} />);

    // The lazy graph chunk resolves and the full-bleed canvas mounts.
    expect(
      await screen.findByTestId("workboard-graph", undefined, SLOW_FIND),
    ).toBeInTheDocument();
    // No page header/title chrome — the canvas owns the whole area.
    expect(
      screen.queryByRole("heading", { name: "Work graph" }),
    ).not.toBeInTheDocument();
  });

  it("navigates to the item's detail page when a graph node is activated (parity)", async () => {
    navMock.fn.mockClear();
    render(<WorkboardGraphScreen repository={createMockWorkItemRepository()} />);

    const open = await screen.findByLabelText(
      "Open Workspace auth hardening",
      undefined,
      SLOW_FIND,
    );
    fireEvent.click(open);

    // Node activation routes to the detail PAGE — the SAME target the table +
    // kanban use — not the quick-edit Sheet.
    await waitFor(() => {
      expect(navMock.fn).toHaveBeenCalledWith({
        to: "/w/$workspace/workboard/item/$itemId",
        params: { workspace: "acme", itemId: "wi_auth" },
      });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("narrows the graph to the matching nodes when the in-canvas search is used", async () => {
    render(<WorkboardGraphScreen repository={createMockWorkItemRepository()} />);

    await screen.findByTestId("workboard-graph", undefined, SLOW_FIND);
    // Multiple nodes render before filtering.
    expect((await screen.findAllByTestId("graph-node")).length).toBeGreaterThan(1);

    // Type a query that matches a single work item into the floating search.
    fireEvent.change(screen.getByLabelText("Search work items"), {
      target: { value: "auth hardening" },
    });

    // The graph now renders only the matching node (filter → applyWorkboardFilters).
    await waitFor(() => {
      const nodes = screen.getAllByTestId("graph-node");
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toHaveAttribute("data-item-id", "wi_auth");
    });
  });

  it("surfaces a load error through the graph's error state", async () => {
    const base = createMockWorkItemRepository();
    const failing = {
      ...base,
      list: vi.fn().mockRejectedValue(new Error("boom")),
    };
    render(<WorkboardGraphScreen repository={failing} />);

    expect(
      await screen.findByText("Could not load work items", undefined, SLOW_FIND),
    ).toBeInTheDocument();
  });
});
