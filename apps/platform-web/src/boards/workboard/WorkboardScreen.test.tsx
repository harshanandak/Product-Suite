import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  observe(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
  unobserve(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
  disconnect(): void {
    /* no-op: jsdom has no ResizeObserver */
  }
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
  // Radix Select (toolbar facet/bulk dropdowns) needs pointer/scroll APIs jsdom omits.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
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
  it("renders the toolbar and the table together", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    expect(
      await screen.findByRole("toolbar", { name: "Workboard controls" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("grid", { name: "Work items" }),
    ).toBeInTheDocument();
  });

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

  it("narrows the rendered rows when the toolbar search changes", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search work items" }), {
      target: { value: "Workspace auth hardening" },
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row")).toHaveLength(1);
    });
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();
  });

  it("bulk-applies a patch to the selected rows then clears the selection", async () => {
    const repository = createMockWorkItemRepository();
    render(<WorkboardScreen repository={repository} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Select one row, which reveals the toolbar's bulk-action cluster.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );
    const bulkGroup = await screen.findByRole("group", { name: "Bulk actions" });
    expect(within(bulkGroup).getByText("1 selected")).toBeInTheDocument();

    // Apply a bulk phase via the explicit "Set phase" menu action; the change
    // persists to the store…
    fireEvent.keyDown(
      within(bulkGroup).getByRole("button", { name: "Set phase" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Done" }));

    await waitFor(async () => {
      const persisted = (await repository.list()).find(
        (item) => item.id === "wi_auth",
      );
      expect(persisted?.phase).toBe("done");
    });

    // …and the selection clears (the bulk cluster disappears).
    await waitFor(() => {
      expect(
        screen.queryByRole("group", { name: "Bulk actions" }),
      ).not.toBeInTheDocument();
    });
  });

  it("creates a work item from the New button and opens the editor on it", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /new work item/i }));

    // The editor opens, seeded from the freshly-created default item.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Untitled work item");
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

  it("shows a clearable no-match state when filters hide every row", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // A search that matches nothing hides every row.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search work items" }), {
      target: { value: "zzz-no-such-item" },
    });

    expect(await screen.findByText("No matching work items")).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-row")).not.toBeInTheDocument();

    // Clearing filters (search included) restores the rows.
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("No matching work items")).not.toBeInTheDocument();
  });
});
