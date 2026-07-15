import { screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, it, expect } from "vitest";

import { CommandPalette } from "./CommandPalette";
import { BOARDS } from "./boards";
import { renderWithRouter } from "../test/harness";

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

describe("CommandPalette", () => {
  it("renders every board label plus Settings when open", async () => {
    renderWithRouter(
      <CommandPalette open onOpenChange={() => {}} workspace="test-ws" />,
    );

    // findBy* waits for the async RouterProvider to commit the route content.
    expect(await screen.findByText(BOARDS[0].label)).toBeDefined();
    for (const board of BOARDS) {
      expect(screen.getByText(board.label)).toBeDefined();
    }
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("offers the Log a decision action", async () => {
    renderWithRouter(
      <CommandPalette open onOpenChange={() => {}} workspace="test-ws" />,
    );
    expect(await screen.findByText("Log a decision")).toBeDefined();
  });

  it("renders nothing when closed", async () => {
    renderWithRouter(
      <CommandPalette
        open={false}
        onOpenChange={() => {}}
        workspace="test-ws"
      />,
    );

    // Let the router commit, then confirm the palette content never appears.
    await waitFor(() => {
      expect(screen.queryByText("Settings")).toBeNull();
    });
    expect(screen.queryByText(BOARDS[0].label)).toBeNull();
  });
});
