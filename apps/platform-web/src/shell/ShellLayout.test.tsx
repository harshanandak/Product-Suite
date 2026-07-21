import * as React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithRouter } from "../test/harness";
import { ShellLayout } from "./ShellLayout";

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
  // ShellLayout's ClerkAgentPanel resolves the agent chat bearer via useAuth.
  useAuth: () => ({ getToken: async () => null }),
}));

vi.mock("./UserMenu", () => ({ UserMenu: () => null }));

// Stand in for the real panel (which pulls in useChat + the vendored AI Elements
// and their ResizeObserver needs). The stub renders only when open and surfaces
// the focus nonce so we can assert a re-invocation re-focuses without closing.
vi.mock("@/agent-chat/AgentChatPanel", () => ({
  AgentChatPanel: ({
    open,
    focusRequest,
  }: {
    open: boolean;
    focusRequest?: { nonce: number };
  }) =>
    open ? (
      <aside aria-label="Agent chat" data-focus-nonce={focusRequest?.nonce}>
        panel
      </aside>
    ) : null,
}));

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

    // Board dock — tier-1 nav: the four board entries in fixed order (the Agent
    // board was deleted in Phase 5).
    const dock = await screen.findByRole("navigation", { name: "Boards" });
    const dockLinks = within(dock).getAllByRole("link");
    expect(dockLinks).toHaveLength(4);
    expect(dockLinks.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home",
      "Workboard",
      "Meeting board",
      "Canvas board",
    ]);

    // Board sidebar — derived from the URL-active board (workboard).
    const sidebar = screen.getByRole("navigation", {
      name: "Workboard navigation",
    });
    expect(within(sidebar).getByText("Workboard")).toBeInTheDocument();
    expect(within(sidebar).getByText("My items")).toBeInTheDocument();
  });

  it("renders the TEAMS section with one row per team and no dead rows", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const sidebar = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });

    // The dynamic TEAMS section (from useTeams over the fixture repository) shows
    // its header plus one row per fixture team.
    expect(await within(sidebar).findByText("Teams")).toBeInTheDocument();
    expect(within(sidebar).getByText("Engineering")).toBeInTheDocument();
    expect(within(sidebar).getByText("Marketing")).toBeInTheDocument();
    expect(within(sidebar).getByText("Sourcing")).toBeInTheDocument();

    // The dead workboard rows are fully gone from the rail.
    for (const dead of [
      "Strategy",
      "Insights",
      "Tasks",
      "Triage",
      "Feedback",
      "Graph",
    ]) {
      expect(within(sidebar).queryByText(dead)).not.toBeInTheDocument();
    }
  });

  it("opens the agent panel from 'Ask agent' and re-invoking keeps it open", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });
    await screen.findByRole("navigation", { name: "Boards" });

    // Closed to start: the always-mounted panel renders nothing.
    expect(screen.queryByLabelText("Agent chat")).toBeNull();

    const askAgent = screen.getByRole("button", { name: "Ask agent" });
    fireEvent.click(askAgent);

    const panel = screen.getByLabelText("Agent chat");
    expect(panel).toBeInTheDocument();
    const firstNonce = panel.getAttribute("data-focus-nonce");

    // Re-invoking while already open must keep it open and bump the focus nonce
    // (a re-focus request through the single seam), never toggle it closed.
    fireEvent.click(askAgent);
    const panelAgain = screen.getByLabelText("Agent chat");
    expect(panelAgain).toBeInTheDocument();
    expect(panelAgain.getAttribute("data-focus-nonce")).not.toBe(firstNonce);
  });

  it("minimizes the rail when the sidebar toggle is clicked", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const sidebar = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    // Expanded: the item label text is visible.
    expect(within(sidebar).getByText("My items")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    // Collapsed: labels collapse to icons, so the label text is gone but the
    // item stays reachable via its accessible name.
    expect(within(sidebar).queryByText("My items")).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "My items" }),
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
    expect(within(sidebar).queryByText("My items")).not.toBeInTheDocument();
    expect(
      within(sidebar).getByRole("link", { name: "My items" }),
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
    expect(within(sidebar).getByText("My items")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("flies the collapsed rail out on hover and collapses it again on leave", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");

    // Resting collapsed: item labels are hidden.
    expect(within(rail).queryByText("My items")).not.toBeInTheDocument();

    // Hover the rail → it flies out, revealing the labels.
    fireEvent.mouseEnter(rail);
    expect(within(rail).getByText("My items")).toBeInTheDocument();

    // Leave → it collapses back to icons.
    fireEvent.mouseLeave(rail);
    expect(within(rail).queryByText("My items")).not.toBeInTheDocument();
  });

  it("flies the collapsed rail out when keyboard focus enters it", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");

    expect(within(rail).queryByText("My items")).not.toBeInTheDocument();

    // Tabbing into the rail (here: focusing the expand toggle) reveals it too.
    // focusIn bubbles, which is what React's onFocus listens for.
    fireEvent.focusIn(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(within(rail).getByText("My items")).toBeInTheDocument();
  });

  it("keeps the toggle offering to pin (Expand) while the rail is only hover-revealed", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");

    fireEvent.mouseEnter(rail);

    // Revealed by hover but NOT pinned: the control should still offer to pin it
    // open ("Expand"), not to "Collapse" something that isn't pinned.
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Collapse sidebar" }),
    ).not.toBeInTheDocument();
  });

  it("stays revealed on mouse-leave while keyboard focus is still inside", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");

    // Keyboard focus reveals the rail...
    fireEvent.focusIn(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(within(rail).getByText("My items")).toBeInTheDocument();

    // ...and a stray mouse-leave must NOT yank it shut (it would drop focus to
    // <body>). Mouse and focus reveal are tracked independently.
    fireEvent.mouseLeave(rail);
    expect(within(rail).getByText("My items")).toBeInTheDocument();
  });

  it("collapses immediately when the toggle is clicked with the pointer over the rail", async () => {
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");

    // Pointer over the rail, then click Collapse: it must commit the collapse,
    // not float open as an overlay until the mouse happens to leave.
    fireEvent.mouseEnter(rail);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(within(rail).queryByText("My items")).not.toBeInTheDocument();
  });

  it("sizes the rail panel and only overlays while hover-revealed", async () => {
    globalThis.localStorage.setItem("ps:sidebar-collapsed", "true");
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");
    const panel = rail.firstElementChild as HTMLElement;

    // Resting collapsed: narrow rail, in-flow (no overlay z-index/shadow).
    expect(panel.style.width).toBe("64px");
    expect(panel.className).not.toMatch(/z-50/);

    // Hover-revealed: widened AND lifted to an overlay.
    fireEvent.mouseEnter(rail);
    expect(panel.style.width).toBe("220px");
    expect(panel.className).toMatch(/z-50/);

    // Leave: back to the narrow resting rail.
    fireEvent.mouseLeave(rail);
    expect(panel.style.width).toBe("64px");
  });

  it("pins open at full width without overlaying the content", async () => {
    // Default (no stored preference) is expanded/pinned.
    renderWithRouter(<ShellLayout />, { path: "/w/test-ws/workboard" });

    const nav = await screen.findByRole("navigation", {
      name: "Workboard navigation",
    });
    const rail = nav.closest("aside");
    if (!rail) throw new Error("rail <aside> not found");
    const panel = rail.firstElementChild as HTMLElement;

    expect(panel.style.width).toBe("220px");
    expect(panel.className).not.toMatch(/z-50/);
  });
});
