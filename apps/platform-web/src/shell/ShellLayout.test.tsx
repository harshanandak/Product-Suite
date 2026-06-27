import * as React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { ShellLayout } from "./ShellLayout";

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
}));

vi.mock("./UserMenu", () => ({ UserMenu: () => null }));

describe("ShellLayout", () => {
  // The collapse preference is persisted to localStorage; clear it (and restore
  // any storage spies) after each test so the rail starts expanded and tests
  // don't leak state into each other.
  afterEach(() => {
    vi.restoreAllMocks();
    try {
      globalThis.localStorage?.removeItem("ps:sidebar-collapsed");
    } catch {
      // storage may be unavailable in the harness; nothing to clean up
    }
  });

  it("composes the signed-in chrome: board dock and board sidebar", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    // Board dock — tier-1 nav: the same five board entries in fixed order.
    const dock = await screen.findByRole("navigation", { name: "Boards" });
    const dockLinks = within(dock).getAllByRole("link");
    expect(dockLinks).toHaveLength(5);
    expect(dockLinks.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home",
      "Workboard",
      "Meeting board",
      "Canvas board",
      "Agent board",
    ]);

    // Board sidebar — derived from the URL-active board (workboard).
    const sidebar = screen.getByRole("navigation", {
      name: "Workboard navigation",
    });
    expect(within(sidebar).getByText("Workboard")).toBeInTheDocument();
    expect(within(sidebar).getByText("Work items")).toBeInTheDocument();
  });

  it("minimizes the rail when the sidebar toggle is clicked", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const sidebar = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    // Expanded: the item label text is visible.
    expect(within(sidebar).getByText("Work items")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    // Collapsed: labels collapse to icons, so the label text is gone but the
    // item stays reachable via its accessible name.
    expect(within(sidebar).queryByText("Work items")).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Work items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("restores the collapsed rail from the persisted preference on mount", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const sidebar = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    // Mounted collapsed straight from storage: labels hidden, expand shown, but
    // items still reachable by their accessible name.
    expect(within(sidebar).queryByText("Work items")).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "Work items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("falls back to the expanded rail when reading localStorage throws", async () => {
    // Private-mode / disabled-storage: readSidebarCollapsed must swallow the
    // throw and default to expanded instead of crashing the shell.
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation((key) => {
      if (key === "ps:sidebar-collapsed") throw new Error("storage blocked");
      return null;
    });
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const sidebar = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    expect(within(sidebar).getByText("Work items")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });
});
