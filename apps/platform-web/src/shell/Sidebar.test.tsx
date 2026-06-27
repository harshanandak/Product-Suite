import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../test/harness";
import { Sidebar } from "./Sidebar";
import { getBoard } from "./boards";

describe("Sidebar", () => {
  it("renders the board title and items, marking the active item", async () => {
    const board = getBoard("workboard");
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(await screen.findByText("Workboard")).toBeDefined();
    expect(screen.getByText("Work items")).toBeDefined();
    expect(screen.getByText("Strategy")).toBeDefined();
    expect(screen.getByText("Feedback")).toBeDefined();

    // "Work items" maps to /w/$workspace/workboard, so it is the active item.
    const activeLink = screen.getByText("Work items").closest("a");
    expect(activeLink?.dataset.active).toBe("true");
  });

  it("does not change items on content navigation within the same board (DESIGN §2)", async () => {
    const board = getBoard("workboard");

    // Render the SAME board for a deeper content path within the board.
    const first = renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard/strategy"
      />,
      { path: "/w/test-ws/workboard/strategy" },
    );

    expect(await screen.findByText("Workboard")).toBeDefined();
    expect(screen.getByText("Work items")).toBeDefined();
    expect(screen.getByText("Strategy")).toBeDefined();
    expect(screen.getByText("Feedback")).toBeDefined();

    first.unmount();

    // Same board, a different content path: the sidebar items are unchanged
    // (the sidebar is derived from the board, not the screen).
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard/feedback"
      />,
      { path: "/w/test-ws/workboard/feedback" },
    );

    expect(await screen.findByText("Workboard")).toBeDefined();
    expect(screen.getByText("Work items")).toBeDefined();
    expect(screen.getByText("Strategy")).toBeDefined();
    expect(screen.getByText("Feedback")).toBeDefined();
  });

  it("renders an icon-only rail when collapsed, keeping accessible names", async () => {
    const board = getBoard("workboard");
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        collapsed
        onToggleCollapse={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );

    // The expand affordance is present and labels are hidden...
    expect(
      await screen.findByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Work items")).not.toBeInTheDocument();

    // ...but items remain reachable through their accessible name (title/aria).
    expect(
      screen.getByRole("link", { name: "Work items" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggleCollapse when the toggle button is clicked", async () => {
    const board = getBoard("workboard");
    const onToggleCollapse = vi.fn();
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        onToggleCollapse={onToggleCollapse}
      />,
      { path: "/w/test-ws/workboard" },
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Collapse sidebar" }),
    );
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("marks exactly one link as the current page on a nested screen", async () => {
    const board = getBoard("workboard");
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard/strategy"
      />,
      { path: "/w/test-ws/workboard/strategy" },
    );

    // The exact screen ("Strategy") is the current page...
    const strategy = await screen.findByRole("link", { name: "Strategy" });
    expect(strategy).toHaveAttribute("aria-current", "page");

    // ...and it is the ONLY one. Without activeOptions={{ exact: true }} the
    // ancestor "Work items" (/workboard) would also match by prefix and claim
    // aria-current="page", giving assistive tech two "current" locations.
    const currentLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(currentLinks).toHaveLength(1);
  });

  it("indents a nested item (Graph) under its parent when expanded, not when collapsed", async () => {
    const board = getBoard("workboard");

    // Expanded: the nested Graph item is indented (pl-7) while a top-level
    // sibling (Work items) is not — Graph reads as a child of Work items.
    const expanded = renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
      />,
      { path: "/w/test-ws/workboard" },
    );
    const graph = (await screen.findByText("Graph")).closest("a");
    expect(graph?.className.split(" ")).toContain("pl-7");
    expect(
      screen.getByText("Work items").closest("a")?.className.split(" "),
    ).not.toContain("pl-7");
    expanded.unmount();

    // Collapsed icon-only rail: the indent is dropped (the collapsed px-0 wins),
    // so a nested item never indents in the rail.
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
        collapsed
        onToggleCollapse={vi.fn()}
      />,
      { path: "/w/test-ws/workboard" },
    );
    // Collapsed sets an explicit aria-label, so the link resolves by name here.
    const graphCollapsed = await screen.findByRole("link", { name: "Graph" });
    expect(graphCollapsed.className.split(" ")).not.toContain("pl-7");
  });

  it("omits the collapse toggle when no onToggleCollapse handler is given", async () => {
    const board = getBoard("workboard");
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(await screen.findByText("Work items")).toBeInTheDocument();
    // No toggle handler → no collapse/expand affordance is rendered.
    expect(
      screen.queryByRole("button", { name: /sidebar/i }),
    ).not.toBeInTheDocument();
  });
});
