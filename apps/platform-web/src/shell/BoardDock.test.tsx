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

  it("keeps all five boards in the DOM when collapsed, hiding the non-active ones", async () => {
    renderWithRouter(
      <BoardDock workspace="test-ws" activeBoard="workboard" collapsed />,
      { path: "/w/test-ws/workboard" },
    );

    // All five stay reachable (accessibility tree + keyboard) even at rest, so
    // browse-mode screen-reader users can still discover the other boards...
    const labels = ["Home", "Workboard", "Meeting board", "Canvas board", "Agent board"];
    for (const label of labels) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }

    // ...but only the active board is visible; the rest are sr-only until expand.
    expect(
      screen.getByRole("link", { name: "Workboard" }).className,
    ).not.toMatch(/sr-only/);
    expect(screen.getByRole("link", { name: "Home" }).className).toMatch(
      /sr-only/,
    );
  });

  it("never renders an empty dock when collapsed on a board-less route", async () => {
    // Settings has no active board (activeBoard === null) — the dock must still
    // carry the full board set rather than collapsing to nothing.
    renderWithRouter(
      <BoardDock workspace="test-ws" activeBoard={null} collapsed />,
      { path: "/w/test-ws/settings" },
    );

    expect((await screen.findAllByRole("link")).length).toBe(5);
  });
});
