import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { ThemeProvider, Toaster, toast } from "@product-suite/ui";

import {
  createMockWorkItemRepository,
  type WorkItemPatch,
} from "@/data/work-items";

import {
  COLUMN_IDS,
  FILTER_STORAGE_KEY,
  SAVED_VIEWS_KEY,
  defaultWorkboardFilterState,
  parsePersistedView,
  parseSavedViews,
  serializePersistedView,
  serializeSavedViews,
  type SavedView,
} from "./filter-state";
import { WorkboardScreen } from "./WorkboardScreen";

/**
 * Render the screen together with the shared sonner `<Toaster/>` (and the
 * ThemeProvider it themes from), so the inline/bulk failure toasts the screen
 * fires are actually mounted and assertable. Production mounts the Toaster once
 * at the app root (main.tsx); these tests mount their own around the screen.
 */
function renderScreenWithToaster(
  repository: ReturnType<typeof createMockWorkItemRepository>,
) {
  return render(
    <ThemeProvider defaultTheme="light">
      <WorkboardScreen repository={repository} />
      <Toaster />
    </ThemeProvider>,
  );
}

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

// The screen persists its view state to localStorage (FILTER_STORAGE_KEY), read
// lazily on mount; isolate every test so a blob one test seeds (or writes) can
// never leak into the next — mirrors WorkboardTable.test.tsx's column-width
// isolation.
beforeEach(() => {
  window.localStorage.clear();
});

// sonner's toast queue is module-global; clear it between tests so a toast from
// one test can never bleed into the next.
afterEach(() => {
  toast.dismiss();
  window.localStorage.clear();
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

  it("prunes the selection to visible rows so bulk acts only on what is shown", async () => {
    const repository = createMockWorkItemRepository();
    render(<WorkboardScreen repository={repository} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    // Select EVERY visible row via the header select-all (10 fixtures).
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );
    const bulkGroup = await screen.findByRole("group", { name: "Bulk actions" });
    expect(within(bulkGroup).getByText("10 selected")).toBeInTheDocument();

    // Narrow the search so only one row stays visible; the rest are hidden by the
    // active filter. The stale ids must be pruned out of the shared selection.
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search work items" }),
      { target: { value: "Workspace auth hardening" } },
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row")).toHaveLength(1);
    });
    // The toolbar count now reflects ONLY the visible selection.
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("group", { name: "Bulk actions" }),
        ).getByText("1 selected"),
      ).toBeInTheDocument();
    });

    // A bulk apply touches only the visible row…
    const bulk = screen.getByRole("group", { name: "Bulk actions" });
    fireEvent.keyDown(
      within(bulk).getByRole("button", { name: "Set phase" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Done" }));

    await waitFor(async () => {
      const items = await repository.list();
      expect(items.find((item) => item.id === "wi_auth")?.phase).toBe("done");
    });
    // …never the hidden, previously-selected rows: wi_realtime keeps its phase.
    const items = await repository.list();
    expect(items.find((item) => item.id === "wi_realtime")?.phase).toBe("plan");
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

  it("surfaces a failed inline edit with a toast instead of swallowing it", async () => {
    const repository = createMockWorkItemRepository();
    // Every update rejects, so the inline Archive action fails.
    const failing = {
      ...repository,
      update: () => Promise.reject(new Error("backend down")),
    };
    renderScreenWithToaster(failing);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Archive via the row actions menu drives an inline update that rejects.
    fireEvent.keyDown(
      screen.getByRole("button", {
        name: "Actions for Workspace auth hardening",
      }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));

    // The failure is announced (no more silent .catch swallow).
    expect(await screen.findByText(/couldn't update/i)).toBeInTheDocument();
  });

  it("toasts when an inline cell-select edit fails (commitPatch path)", async () => {
    const repository = createMockWorkItemRepository();
    const failing = {
      ...repository,
      update: () => Promise.reject(new Error("backend down")),
    };
    renderScreenWithToaster(failing);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Change the inline Phase select — this routes through commitPatch, whose
    // rejection must surface a toast (not the row-actions Archive path above).
    const combobox = screen.getByRole("combobox", {
      name: "Phase for Workspace auth hardening",
    });
    fireEvent.keyDown(combobox, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Done" }));

    expect(await screen.findByText(/couldn't update/i)).toBeInTheDocument();
  });

  it("keeps the failed id selected on a bulk partial failure and toasts", async () => {
    const repository = createMockWorkItemRepository();
    // Only wi_auth's update rejects; every other row's update goes through.
    const failing = {
      ...repository,
      update: (id: string, patch: WorkItemPatch) =>
        id === "wi_auth"
          ? Promise.reject(new Error("backend down"))
          : repository.update(id, patch),
    };
    renderScreenWithToaster(failing);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    // Select every visible row (10 fixtures), then bulk-set the phase to Done.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );
    const bulkGroup = await screen.findByRole("group", { name: "Bulk actions" });
    expect(within(bulkGroup).getByText("10 selected")).toBeInTheDocument();

    fireEvent.keyDown(
      within(bulkGroup).getByRole("button", { name: "Set phase" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Done" }));

    // The nine that succeeded drop out of the selection; the one that FAILED
    // (wi_auth) stays selected so it can be retried.
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("group", { name: "Bulk actions" }),
        ).getByText("1 selected"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    ).toBeChecked();

    // The partial failure is announced.
    expect(await screen.findByText(/couldn't update/i)).toBeInTheDocument();

    // The succeeded rows persisted; the failed one was rolled back to its
    // original phase (wi_auth seeds "execute"), never the attempted "done".
    // The failed row's optimistic patch is ROLLED BACK in the RENDERED table:
    // wi_auth still shows its original "Execute" phase, never the attempted "Done".
    // (Asserting the DOM, not the store — the failing override rejects before the
    // backing store would mutate, so a store check here is a tautology.)
    expect(
      screen.getByRole("combobox", {
        name: "Phase for Workspace auth hardening",
      }),
    ).toHaveTextContent(/execute/i);
    // The succeeded rows did persist to the store.
    const items = await repository.list();
    expect(items.find((item) => item.id === "wi_realtime")?.phase).toBe("done");
  });

  it("restores persisted search, groupBy, and visibleColumns from localStorage", async () => {
    const base = defaultWorkboardFilterState();
    // Hide the Tags column and group by Type instead of the default Department.
    const visibleColumns = new Set(
      COLUMN_IDS.filter((id) => id !== "tags"),
    );
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      serializePersistedView({
        filterState: {
          ...base,
          search: "auth",
          groupBy: "type",
          visibleColumns,
        },
        view: "table",
      }),
    );

    const { container } = render(
      <WorkboardScreen repository={createMockWorkItemRepository()} />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // search restored → the controlled searchbox shows it (and narrows the rows).
    expect(
      screen.getByRole("searchbox", { name: "Search work items" }),
    ).toHaveValue("auth");
    // groupBy restored → swimlanes are by Type ("Feature"), not Department.
    expect(container.querySelector('[data-group="Feature"]')).not.toBeNull();
    expect(container.querySelector('[data-group="Engineering"]')).toBeNull();
    // visibleColumns restored → the Tags column (its inline edit button) is gone.
    expect(
      screen.queryByLabelText("Edit tags for Workspace auth hardening"),
    ).not.toBeInTheDocument();
  });

  it("restores a persisted facet filter (Phase) into the live filter state", async () => {
    const base = defaultWorkboardFilterState();
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      serializePersistedView({
        filterState: {
          ...base,
          filters: { ...base.filters, phase: new Set(["execute"] as const) },
        },
        view: "table",
      }),
    );

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // The restored facet shows as an active count on the column-header trigger
    // ("Filter Phase (1)"); opening it shows "Execute" already checked — proving
    // the restored facet Set flows into the live filter state.
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Filter Phase (1)" }),
      { key: "ArrowDown" },
    );
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Execute" }),
    ).toBeChecked();
  });

  it("restores the persisted Kanban view from localStorage", async () => {
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      serializePersistedView({
        filterState: defaultWorkboardFilterState(),
        view: "kanban",
      }),
    );

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    // The Kanban board (not the table grid) is the first surface shown.
    expect(await screen.findByTestId("workboard-kanban")).toBeInTheDocument();
    expect(
      screen.queryByRole("grid", { name: "Work items" }),
    ).not.toBeInTheDocument();
  });

  it("never restores a stale selection — selection rehydrates empty", async () => {
    // Hand-craft a blob carrying a selection key (the serializer never writes
    // one); the parser must ignore it so no rows start selected.
    const valid = JSON.parse(
      serializePersistedView({
        filterState: defaultWorkboardFilterState(),
        view: "table",
      }),
    );
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({ ...valid, selection: ["wi_auth", "wi_realtime"] }),
    );

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    // An empty selection means the bulk-action cluster never appears.
    expect(
      screen.queryByRole("group", { name: "Bulk actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    ).not.toBeChecked();
  });

  it("persists a filter change to localStorage", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search work items" }),
      { target: { value: "Workspace auth hardening" } },
    );

    await waitFor(() => {
      const parsed = parsePersistedView(
        window.localStorage.getItem(FILTER_STORAGE_KEY),
      );
      expect(parsed?.search).toBe("Workspace auth hardening");
    });
  });

  it("does NOT write the selection into the persisted blob", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    // Wait for the mount-time write, then snapshot the exact stored blob.
    await waitFor(() => {
      expect(window.localStorage.getItem(FILTER_STORAGE_KEY)).not.toBeNull();
    });
    const before = window.localStorage.getItem(FILTER_STORAGE_KEY);

    // Selecting a row mutates the selection (the bulk cluster appears)…
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("group", { name: "Bulk actions" }),
        ).getByText("1 selected"),
      ).toBeInTheDocument();
    });

    // …but the serialized blob is byte-identical: selection is never persisted.
    expect(window.localStorage.getItem(FILTER_STORAGE_KEY)).toBe(before);
    expect(
      parsePersistedView(window.localStorage.getItem(FILTER_STORAGE_KEY)),
    ).not.toHaveProperty("selection");
  });

  it("falls back to defaults when the stored blob is malformed (never throws)", async () => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, "not json {{{");

    expect(() =>
      render(<WorkboardScreen repository={createMockWorkItemRepository()} />),
    ).not.toThrow();

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    // Defaults: empty search, the full table grid present (not Kanban).
    expect(
      screen.getByRole("searchbox", { name: "Search work items" }),
    ).toHaveValue("");
    expect(
      screen.getByRole("grid", { name: "Work items" }),
    ).toBeInTheDocument();
  });

  it("re-adds a failed bulk id even when the optimistic patch + prune removed it under an active filter", async () => {
    const repository = createMockWorkItemRepository();
    // Only wi_auth's update rejects; the rest go through.
    const failing = {
      ...repository,
      update: (id: string, patch: WorkItemPatch) =>
        id === "wi_auth"
          ? Promise.reject(new Error("backend down"))
          : repository.update(id, patch),
    };
    renderScreenWithToaster(failing);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    // Filter to Phase = Execute (wi_auth seeds "execute", so it stays visible).
    // Phase now filters from its COLUMN HEADER (the toolbar facet moved there).
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter Phase" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "Execute" }),
    );
    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
      ).toBeInTheDocument();
    });

    // Select the visible (Execute) rows, then bulk-set Phase = Done — which moves
    // them OUT of the active filter optimistically, so the prune effect drops them
    // from the selection BEFORE wi_auth's write rejects and rolls back.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );
    const bulkGroup = await screen.findByRole("group", { name: "Bulk actions" });
    fireEvent.keyDown(
      within(bulkGroup).getByRole("button", { name: "Set phase" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Done" }));

    // wi_auth failed → rolled back to Execute → reappears AND stays selected
    // (re-added). With the old code it would have been pruned and never restored.
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
      ).toBeChecked();
    });
    expect(await screen.findByText(/couldn't update/i)).toBeInTheDocument();
  });

  // --- Saved / named views (Rank 8b) -------------------------------------

  it("saves the current view (filters/search, NOT selection) to SAVED_VIEWS_KEY", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // Narrow to a single row, then SELECT it — the selection must never be
    // captured into the saved config.
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search work items" }),
      { target: { value: "Workspace auth hardening" } },
    );
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row")).toHaveLength(1);
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select Workspace auth hardening" }),
    );

    // Save the current view under a name.
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "View name" }),
      { target: { value: "Auth lane" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Persisted under the saved-views key, capturing the search but no selection.
    await waitFor(() => {
      const saved = parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY));
      expect(saved).toHaveLength(1);
      expect(saved[0]?.name).toBe("Auth lane");
      expect(saved[0]?.config.search).toBe("Workspace auth hardening");
    });
    const saved = parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY));
    expect(saved[0]?.config).not.toHaveProperty("selection");
    expect(saved[0]?.id).toBeTruthy();
    // The raw blob carries no selected row id (wi_auth was selected at save time).
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).not.toContain("wi_auth");
  });

  it("applies a saved view: hydrates its config and resets the selection", async () => {
    const views: SavedView[] = [
      { id: "v1", name: "Auth only", config: { search: "Workspace auth hardening" } },
    ];
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(views));

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    // Select every row so a non-empty selection exists BEFORE applying.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );
    await screen.findByRole("group", { name: "Bulk actions" });

    // Apply the saved view via the Saved views menu.
    fireEvent.keyDown(screen.getByRole("button", { name: "Saved views" }), {
      key: "ArrowDown",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Auth only" }));

    // The config's search now narrows the table to its single match…
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row")).toHaveLength(1);
    });
    expect(
      screen.getByRole("searchbox", { name: "Search work items" }),
    ).toHaveValue("Workspace auth hardening");
    // …and the selection is reset to empty (the bulk cluster disappears).
    await waitFor(() => {
      expect(
        screen.queryByRole("group", { name: "Bulk actions" }),
      ).not.toBeInTheDocument();
    });
  });

  it("deletes a saved view, removing it from storage", async () => {
    const views: SavedView[] = [
      { id: "v1", name: "Auth only", config: { search: "auth" } },
    ];
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(views));

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Saved views" }), {
      key: "ArrowDown",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete view Auth only" }),
    );

    await waitFor(() => {
      expect(
        parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_KEY)),
      ).toHaveLength(0);
    });
  });

  it("restores saved views from localStorage on mount", async () => {
    const views: SavedView[] = [
      { id: "v1", name: "Restored lane", config: { search: "auth" } },
    ];
    window.localStorage.setItem(SAVED_VIEWS_KEY, serializeSavedViews(views));

    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Saved views" }), {
      key: "ArrowDown",
    });
    expect(
      await screen.findByRole("button", { name: "Restored lane" }),
    ).toBeInTheDocument();
  });
});
