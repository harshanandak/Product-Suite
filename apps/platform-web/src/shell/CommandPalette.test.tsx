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
});
