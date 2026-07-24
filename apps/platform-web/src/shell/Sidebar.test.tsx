import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithRouter } from "../test/harness";
import { Sidebar } from "./Sidebar";
import { buildHomeItems, buildWorkboardItems, getBoard } from "./boards";

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
    expect(screen.getByText("My items")).toBeDefined();
    expect(screen.getByText("Views")).toBeDefined();
    expect(screen.getByText("Projects")).toBeDefined();

    // "My items" maps to /w/$workspace/workboard, so it is the active item.
    const activeLink = screen.getByText("My items").closest("a");
    expect(activeLink?.dataset.active).toBe("true");
  });

  it("does not change items on content navigation within the same board (DESIGN §2)", async () => {
    const board = getBoard("workboard");

    // Render the SAME board for a deeper content path within the board.
    const first = renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard/item/wi_auth"
      />,
      { path: "/w/test-ws/workboard/item/wi_auth" },
    );

    expect(await screen.findByText("Workboard")).toBeDefined();
    expect(screen.getByText("My items")).toBeDefined();
    expect(screen.getByText("Views")).toBeDefined();
    expect(screen.getByText("Projects")).toBeDefined();

    first.unmount();

    // Same board, a different content path: the sidebar items are unchanged
    // (the sidebar is derived from the board, not the screen).
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard"
      />,
      { path: "/w/test-ws/workboard" },
    );

    expect(await screen.findByText("Workboard")).toBeDefined();
    expect(screen.getByText("My items")).toBeDefined();
    expect(screen.getByText("Views")).toBeDefined();
    expect(screen.getByText("Projects")).toBeDefined();
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
    expect(screen.queryByText("My items")).not.toBeInTheDocument();

    // ...but items remain reachable through their accessible name (title/aria).
    expect(
      screen.getByRole("link", { name: "My items" }),
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

  it("marks exactly one link as the current page on a team screen", async () => {
    // A workboard rail with a TEAMS section: the team row's path
    // (/workboard/team/engineering) has the "My items" row (/workboard) as a
    // prefix, so this exercises the exact-match guard.
    const board = {
      ...getBoard("workboard"),
      items: buildWorkboardItems([{ id: "engineering", name: "Engineering" }]),
    };
    renderWithRouter(
      <Sidebar
        board={board}
        workspace="test-ws"
        pathname="/w/test-ws/workboard/team/engineering"
      />,
      { path: "/w/test-ws/workboard/team/engineering" },
    );

    // The exact screen ("Engineering") is the current page...
    const team = await screen.findByRole("link", { name: "Engineering" });
    expect(team).toHaveAttribute("aria-current", "page");

    // ...and it is the ONLY one. Without activeOptions={{ exact: true }} the
    // ancestor "My items" (/workboard) would also match by prefix and claim
    // aria-current="page", giving assistive tech two "current" locations.
    const currentLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(currentLinks).toHaveLength(1);
  });

  it("renders the live review-queue count badge on the home rail", async () => {
    // The home board built with 3 pending proposals must show "3" on Review
    // queue — not a hardcoded literal — and no badge on Chat.
    const board = { ...getBoard("home"), items: buildHomeItems(3) };
    renderWithRouter(
      <Sidebar board={board} workspace="test-ws" pathname="/w/test-ws" />,
      { path: "/w/test-ws" },
    );

    const review = (await screen.findByText("Review queue")).closest("a");
    expect(review).toHaveTextContent("3");
    const chat = screen.getByText("Chat").closest("a");
    // Chat has no count source, so its only text content is its label.
    expect(chat?.textContent).toBe("Chat");
  });

  it("renders no review-queue badge when the pending count is zero", async () => {
    const board = { ...getBoard("home"), items: buildHomeItems(0) };
    renderWithRouter(
      <Sidebar board={board} workspace="test-ws" pathname="/w/test-ws" />,
      { path: "/w/test-ws" },
    );

    const review = (await screen.findByText("Review queue")).closest("a");
    // No badge → the link's text is exactly its label, no trailing number.
    expect(review?.textContent).toBe("Review queue");
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

    expect(await screen.findByText("My items")).toBeInTheDocument();
    // No toggle handler → no collapse/expand affordance is rendered.
    expect(
      screen.queryByRole("button", { name: /sidebar/i }),
    ).not.toBeInTheDocument();
  });
});
