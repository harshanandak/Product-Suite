import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMockWorkItemRepository } from "@/data/work-items";

import { WorkboardScreen } from "./WorkboardScreen";

/**
 * The screen renders BOTH the virtualized table and the Radix Sheet, so the test
 * environment needs both stubs:
 *
 *  - `offsetHeight`/`offsetWidth`: jsdom has no layout engine, so
 *    @tanstack/react-virtual reads a zero-height scroll element and renders no
 *    rows. Its `getRect` reads `offsetWidth`/`offsetHeight` (NOT
 *    `getBoundingClientRect`), so we override those to give it a real viewport.
 *  - `ResizeObserver`: undefined in jsdom; required by both the virtualizer and
 *    the Sheet (Radix Dialog).
 *
 * Scoped to this file (the shared test/setup.ts is out of this dir's ownership).
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);

beforeAll(() => {
  globalThis.ResizeObserver ??= ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 800,
  });
});

afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
});

describe("WorkboardScreen", () => {
  it("shows the table with items and opens the editor when a row is selected", async () => {
    const repository = createMockWorkItemRepository();
    render(<WorkboardScreen repository={repository} />);

    // Verify rows actually render under jsdom before asserting selection — a
    // virtualizer that reports zero height would silently render no rows.
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // A known fixture title is shown as an activatable button.
    const titleButton = await screen.findByRole("button", {
      name: "Workspace auth hardening",
    });
    fireEvent.click(titleButton);

    // The editor Sheet opens (Radix Dialog → role="dialog").
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Edit work item")).toBeInTheDocument();

    // It is seeded from the selected item, and shows that item's tasks.
    expect(screen.getByLabelText("Title")).toHaveValue("Workspace auth hardening");
    expect(screen.getByText("Token verifier interface")).toBeInTheDocument();
  });

  it("renders the empty state when the repository has no work items", async () => {
    const repository = createMockWorkItemRepository();
    // Drain the fixture store so the loaded list is empty.
    const empty = {
      ...repository,
      list: () => Promise.resolve([]),
    };

    render(<WorkboardScreen repository={empty} />);

    expect(await screen.findByText("No work items yet")).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-row")).not.toBeInTheDocument();
  });
});
