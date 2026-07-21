import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, it, expect, vi } from "vitest";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { ThemeProvider } from "@product-suite/ui";

import { AskAgentProvider, type AskAgent } from "@/agent-chat/ask-agent";

import { CommandPalette } from "./CommandPalette";
import { BOARDS } from "./boards";
import { renderWithRouter } from "../test/harness";
import { createMockWorkItemRepository } from "../data/work-items";

// cmdk relies on ResizeObserver, Element.scrollIntoView, and window.scrollTo,
// none of which jsdom implements.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {
      /* noop: jsdom stub */
    }
    unobserve(): void {
      /* noop: jsdom stub */
    }
    disconnect(): void {
      /* noop: jsdom stub */
    }
  };
  Element.prototype.scrollIntoView = () => {};
  if (typeof window.scrollTo !== "function") {
    window.scrollTo = () => {};
  }
});

// The palette reaches the agent-invocation seam via context, so every render
// wraps it in a provider (defaulting to a spy so wiring can be asserted).
function renderPalette(
  props: Partial<ComponentProps<typeof CommandPalette>> = {},
  askAgent: AskAgent = vi.fn(),
) {
  return renderWithRouter(
    <AskAgentProvider value={askAgent}>
      <CommandPalette
        open
        onOpenChange={() => {}}
        workspace="test-ws"
        {...props}
      />
    </AskAgentProvider>,
  );
}

/**
 * Render the palette inside a router that actually registers the work-item
 * detail route, so selecting an item can be asserted against the resulting
 * location. Returns the router for `router.state.location.pathname` assertions.
 * The palette requires the agent-invocation seam, so the surface is wrapped in
 * an AskAgentProvider (a spy — these tests don't exercise the agent).
 */
function renderPaletteWithItemRoute(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$workspace",
    component: () => (
      <ThemeProvider defaultTheme="light">
        <Outlet />
      </ThemeProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/",
    component: () => <AskAgentProvider value={vi.fn()}>{ui}</AskAgentProvider>,
  });
  const itemRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "workboard/item/$itemId",
    component: () => <div>item detail</div>,
  });
  const routeTree = rootRoute.addChildren([
    workspaceRoute.addChildren([indexRoute, itemRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/w/test-ws"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("CommandPalette", () => {
  it("renders every board label plus Settings when open", async () => {
    renderPalette();

    // findBy* waits for the async RouterProvider to commit the route content.
    expect(await screen.findByText(BOARDS[0].label)).toBeDefined();
    for (const board of BOARDS) {
      expect(screen.getByText(board.label)).toBeDefined();
    }
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("offers the Log a decision action", async () => {
    renderPalette();
    expect(await screen.findByText("Log a decision")).toBeDefined();
  });

  it("renders nothing when closed", async () => {
    renderPalette({ open: false });

    // Let the router commit, then confirm the palette content never appears.
    await waitFor(() => {
      expect(screen.queryByText("Settings")).toBeNull();
    });
    expect(screen.queryByText(BOARDS[0].label)).toBeNull();
  });

  it("lists work items from the repository and filters by title", async () => {
    const repository = createMockWorkItemRepository();
    renderPalette({ repository });

    // The Work items group is populated from repository.list() on open.
    expect(await screen.findByText("Realtime transport seam")).toBeDefined();
    expect(screen.getByText("Workspace auth hardening")).toBeDefined();

    // Typing a title narrows the list via cmdk's built-in filtering.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Realtime transport" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Workspace auth hardening")).toBeNull(),
    );
    expect(screen.getByText("Realtime transport seam")).toBeDefined();
  });

  it("matches a work item by its id (open-by-id)", async () => {
    const repository = createMockWorkItemRepository();
    renderPalette({ repository });

    await screen.findByText("Realtime transport seam");

    // The item's id is folded into the cmdk value, so typing the raw id matches.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "wi_realtime" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Workspace auth hardening")).toBeNull(),
    );
    expect(screen.getByText("Realtime transport seam")).toBeDefined();
  });

  it("navigates to the item detail page on select", async () => {
    const repository = createMockWorkItemRepository();
    const router = renderPaletteWithItemRoute(
      <CommandPalette
        open
        onOpenChange={() => {}}
        workspace="test-ws"
        repository={repository}
      />,
    );

    fireEvent.click(await screen.findByText("Realtime transport seam"));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/w/test-ws/workboard/item/wi_realtime",
      ),
    );
  });

  it("wires 'Ask agent' to the invocation seam and closes the palette", async () => {
    const askAgent = vi.fn();
    const onOpenChange = vi.fn();
    renderPalette({ onOpenChange }, askAgent);

    fireEvent.click(await screen.findByText("Ask agent"));

    // The dead-stub fix: selecting the item opens the agent chat via the seam...
    expect(askAgent).toHaveBeenCalledTimes(1);
    // ...and closes the palette first so the two overlays never stack.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Tab flips the palette into Ask-agent prompt mode with a route context chip", async () => {
    renderPalette();

    // Wait for the search surface, then Tab into prompt mode (mockup §3c).
    const searchInput = await screen.findByRole("combobox");
    fireEvent.keyDown(searchInput, { key: "Tab" });

    // The prompt input replaces the search list…
    expect(screen.getByLabelText("Agent prompt")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    // …and a context chip shows what the agent is scoped to (the current route —
    // "/w/test-ws" resolves to the home Digest screen in the harness).
    expect(screen.getByLabelText("Agent context")).toHaveTextContent("Digest");
  });

  it("traps focus on the prompt textarea in prompt mode (Tab cannot escape the dialog)", async () => {
    renderPalette();

    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Tab" });
    const prompt = screen.getByLabelText("Agent prompt");
    prompt.focus();
    expect(document.activeElement).toBe(prompt);

    // The textarea is the ONLY focusable element in prompt mode, so the focus
    // trap must cycle Tab back onto it rather than letting focus reach the inert
    // chrome behind the backdrop. A cancelled event (fireEvent → false) proves
    // the trap handled it; activeElement staying on the textarea proves the loop.
    expect(fireEvent.keyDown(prompt, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(prompt);
    // Shift+Tab (backward) is trapped the same way.
    expect(fireEvent.keyDown(prompt, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(prompt);
  });

  it("submits the typed prompt to the agent seam bound to route context, and closes", async () => {
    const askAgent = vi.fn();
    const onOpenChange = vi.fn();
    renderPalette({ onOpenChange }, askAgent);

    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Tab" });
    const prompt = screen.getByLabelText("Agent prompt");
    fireEvent.change(prompt, { target: { value: "break this item into tasks" } });
    fireEvent.keyDown(prompt, { key: "Enter" });

    // Enter hands the prompt to the SAME invocation seam the panel opens through,
    // scoped to the object shown in the chip (the CURRENT route — "/w/test-ws"
    // resolves to the home Digest screen) so the submission can't bind to a stale
    // pre-existing thread's context.
    expect(askAgent).toHaveBeenCalledWith({
      prompt: "break this item into tasks",
      object: { type: "screen", id: "/w/test-ws", title: "Digest" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not submit an empty prompt", async () => {
    const askAgent = vi.fn();
    renderPalette({}, askAgent);
    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Tab" });
    fireEvent.keyDown(screen.getByLabelText("Agent prompt"), { key: "Enter" });
    expect(askAgent).not.toHaveBeenCalled();
  });

  it("Escape leaves prompt mode back to search without closing the palette", async () => {
    const onOpenChange = vi.fn();
    renderPalette({ onOpenChange });

    fireEvent.keyDown(await screen.findByRole("combobox"), { key: "Tab" });
    expect(screen.getByLabelText("Agent prompt")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Agent prompt"), { key: "Escape" });

    // First Escape returns to search (palette still open); it does not close.
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByLabelText("Agent prompt")).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
