import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithRouter } from "../test/harness";
import { BoardDock } from "./BoardDock";

describe("BoardDock", () => {
  it("renders the five board links and marks the active board", async () => {
    renderWithRouter(
      <BoardDock workspace="test-ws" activeBoard="workboard" />,
      { path: "/w/test-ws/workboard" },
    );

    // The same five icons in fixed order on every screen (DESIGN §2).
    // findBy* waits for the async RouterProvider to mount the route content.
    const labels = ["Home", "Workboard", "Meeting board", "Canvas board", "Agent board"];
    for (const label of labels) {
      expect(await screen.findByRole("link", { name: label })).toBeDefined();
    }

    // Only the active board's highlight moves: Workboard is current.
    const workboardLink = screen.getByRole("link", { name: "Workboard" });
    expect(workboardLink.dataset.active).toBe("true");
    expect(workboardLink.getAttribute("aria-current")).toBe("page");

    // Inactive boards carry no component-owned active marker. (Only data-active
    // is asserted here: aria-current is also managed by the router's own active
    // matching, so it is not a reliable signal of this component's behavior.)
    const homeLink = screen.getByRole("link", { name: "Home" });
    expect(homeLink.dataset.active).toBeUndefined();
  });

  it("shows only the active board when collapsed (others appear on expand)", async () => {
    renderWithRouter(
      <BoardDock workspace="test-ws" activeBoard="workboard" collapsed />,
      { path: "/w/test-ws/workboard" },
    );

    // At rest the dock is a single active-board indicator; the other four are
    // revealed only once the rail expands (hover/pin).
    expect(
      await screen.findByRole("link", { name: "Workboard" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Meeting board" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
