import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { ShellLayout } from "./ShellLayout";

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
  UserButton: () => null,
}));

describe("ShellLayout", () => {
  it("composes the signed-in chrome: board dock, board sidebar, and breadcrumb", async () => {
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

    // Breadcrumb — workspace / board / screen.
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByText("Test WS")).toBeInTheDocument();
    expect(
      within(breadcrumb).getByRole("link", { name: "Workboard" }),
    ).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Work items")).toBeInTheDocument();
  });
});
