import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
});
