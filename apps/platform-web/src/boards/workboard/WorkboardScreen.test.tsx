import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ThemeProvider, Toaster, toast } from "@product-suite/ui";

import {
  createMockWorkItemRepository,
  RepositoryProvider,
  type Check,
  type CreateWorkItemInput,
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

// Row activation now navigates to the detail route. Mock the router so the
// screen's useNavigate/useParams resolve without a RouterProvider, and capture
// the navigate call for assertions.
// The real TanStack `navigate` returns a Promise; the screen calls
// `.catch(...)` on it, so the mock must resolve to keep that chain valid.
const navMock = vi.hoisted(() => ({ fn: vi.fn(() => Promise.resolve()) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navMock.fn,
  useParams: () => ({ workspace: "acme" }),
}));

// For the context-repository test: a signed-in Clerk token so the network repo
// attaches a bearer and issues real fetches.
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "tok_test" }),
}));

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
  navMock.fn.mockClear();
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

  it("scopes rows to the given teamId and hides the Team facet", async () => {
    render(
      <WorkboardScreen
        repository={createMockWorkItemRepository()}
        teamId="team_engineering"
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // An Engineering item is present…
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();
    // …and a Marketing item (Diwali creative set) is scoped out of the surface.
    expect(
      screen.queryByRole("button", { name: "Diwali creative set" }),
    ).not.toBeInTheDocument();

    // The Team facet is hidden — the scope is fixed by the route.
    expect(
      screen.queryByRole("button", { name: "Filter by team" }),
    ).not.toBeInTheDocument();
  });

  it("still applies search within the team scope", async () => {
    render(
      <WorkboardScreen
        repository={createMockWorkItemRepository()}
        teamId="team_engineering"
      />,
    );

    // Engineering seeds four items, so more than one row shows before searching.
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(1);
    });

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search work items" }),
      { target: { value: "Workspace auth hardening" } },
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row")).toHaveLength(1);
    });
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();
  });

  it("ignores a persisted Team filter on a team-scoped route", async () => {
    // A stale Team facet selected on the unscoped board (here "Marketing")
    // conflicts with the Engineering scope. The scoped route hides the Team
    // facet, so if the persisted selection still filtered the rows the user
    // would be stranded on an EMPTY, unclearable board. The scoped view must
    // ignore the persisted team facet entirely.
    const base = defaultWorkboardFilterState();
    window.localStorage.setItem(
      FILTER_STORAGE_KEY,
      serializePersistedView({
        filterState: {
          ...base,
          filters: { ...base.filters, team: new Set(["Marketing"]) },
        },
        view: "table",
      }),
    );

    render(
      <WorkboardScreen
        repository={createMockWorkItemRepository()}
        teamId="team_engineering"
      />,
    );

    // The team's items still render despite the conflicting persisted facet.
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("button", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();
  });

  it("shows the team empty state when the team has no items", async () => {
    render(
      <WorkboardScreen
        repository={createMockWorkItemRepository()}
        teamId="team_does_not_exist"
      />,
    );

    expect(
      await screen.findByText("No items in this team yet"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("work-item-row")).not.toBeInTheDocument();
  });

  it("navigates to the item's detail page when a row is activated", async () => {
    render(<WorkboardScreen repository={createMockWorkItemRepository()} />);

    // Verify rows actually render under jsdom before activating one — a
    // virtualizer that reports zero height would silently render no rows.
    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // A known fixture title is shown as an activatable button.
    const titleButton = await screen.findByRole("button", {
      name: "Workspace auth hardening",
    });
    fireEvent.click(titleButton);

    // Row activation routes to the full detail PAGE — not the editor Sheet.
    expect(navMock.fn).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard/item/$itemId",
      params: { workspace: "acme", itemId: "wi_auth" },
    });
    // A plain row activation no longer opens the quick-edit Sheet.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("creates a work item from the New button, opens the editor, and shows that item's per-item checks", async () => {
    const base = createMockWorkItemRepository();
    const NEW_ITEM_TASK_TITLE = "Kickoff check for the new item";
    // The editor's check list is fed by a PER-ITEM read (useItemChecks), not the
    // board-wide check set. A freshly created item gets the mock's generated
    // "wi_new_…" id, so seed a check for whatever new id is fetched — proving the
    // per-item fetch runs for the created item and feeds the sheet.
    const getChecks = vi.fn((workItemId: string) =>
      workItemId.startsWith("wi_new_")
        ? Promise.resolve([
            {
              id: "t_new_item",
              work_item_id: workItemId,
              title: NEW_ITEM_TASK_TITLE,
              status: "todo",
              due_date: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } satisfies Check,
          ])
        : base.getChecks(workItemId),
    );
    const repository = { ...base, getChecks };

    render(<WorkboardScreen repository={repository} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /new work item/i }));

    // The editor opens, seeded from the freshly-created default item.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Untitled work item");

    // useItemChecks fetched THAT item's checks per-item (its generated id) — never
    // a board-wide read…
    await waitFor(() => {
      expect(getChecks).toHaveBeenCalledWith(
        expect.stringMatching(/^wi_new_/),
      );
    });
    // …and those checks render inside the editor sheet.
    expect(
      await within(dialog).findByText(NEW_ITEM_TASK_TITLE),
    ).toBeInTheDocument();
  });

  it("threads the scoped teamId, department, AND a valid status_id into a new item", async () => {
    // On a team-scoped route, New must create INTO that team. Otherwise the
    // repository backfills team_id from a default and the fresh item lands on
    // another team, vanishing from the scoped list (CodeRabbit
    // WorkboardScreen.tsx:663).
    //
    // team_id alone is scope-correct, but the screen's Team grouping/search/
    // labels still read `row.department`, which the repo ALSO backfills from a
    // default when omitted — so the new item would DISPLAY under the wrong Team
    // column on the scoped page (CodeRabbit WorkboardScreen.tsx:452). The scoped
    // team's name (department carrier) must ride along too. All scoped items
    // share the team, so team_sourcing's items carry department "Sourcing".
    //
    // status_id is MANDATORY on the production API — the mock backfills it, but
    // the network repo posts the raw input and a create without status_id is
    // rejected (CodeRabbit WorkboardScreen.tsx:474). Borrow a sibling scoped
    // item's status so the payload is prod-valid.
    const base = createMockWorkItemRepository();
    const create = vi.fn(base.create);
    const repository = { ...base, create };

    // The sibling status_id the screen should borrow: the first team_sourcing
    // item's status (derived from data, not hard-coded, to stay robust).
    const items = await base.list();
    const sibling = items.find((item) => item.team_id === "team_sourcing");
    expect(sibling?.status_id).toBeTruthy();

    render(<WorkboardScreen repository={repository} teamId="team_sourcing" />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // A non-empty scoped team can source a valid same-team status, so New is
    // enabled.
    const newButton = screen.getByRole("button", { name: /new work item/i });
    expect(newButton).not.toBeDisabled();
    fireEvent.click(newButton);

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          team_id: "team_sourcing",
          department: "Sourcing",
          status_id: sibling?.status_id,
        }),
      );
    });
  });

  it("disables New on an EMPTY team-scoped route so no invalid-status create is posted", async () => {
    // With no same-team sibling there is no valid team status to source, and the
    // prod create verifies status_id against the submitted team_id — so a create
    // would send a cross-team/missing status and 400 (CodeRabbit
    // WorkboardScreen.tsx:248). "Can't do it correctly yet → don't offer it":
    // the New action is disabled until team status setup exists (issue 8a3c0d6b).
    const base = createMockWorkItemRepository();
    const create = vi.fn(base.create);
    const repository = { ...base, create };

    render(
      <WorkboardScreen repository={repository} teamId="team_does_not_exist" />,
    );

    // The empty-team state renders…
    expect(
      await screen.findByText("No items in this team yet"),
    ).toBeInTheDocument();

    // …and EVERY New action (toolbar + empty-state) is disabled.
    const newButtons = screen.getAllByRole("button", { name: /new work item/i });
    expect(newButtons.length).toBeGreaterThan(0);
    for (const button of newButtons) {
      expect(button).toBeDisabled();
    }

    // Clicking never fires a create — no cross-team/missing-status POST.
    fireEvent.click(newButtons[0]);
    await Promise.resolve();
    expect(create).not.toHaveBeenCalled();
  });

  it("derives team_id + status_id + department + phase from the first item as an atomic quadruple for the unscoped New", async () => {
    const base = createMockWorkItemRepository();
    const createSpy = vi.fn((input: CreateWorkItemInput) => base.create(input));
    const repository = { ...base, create: createSpy };

    render(<WorkboardScreen repository={repository} />);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    // The screen derives the create defaults from the FIRST loaded item; capture
    // it so the assertion tracks the fixture rather than hard-coding its ids.
    const [first] = await base.list();
    // The fixture's first item is a NON-plan phase (fixtures seed wi_auth as
    // "execute"), so passing phase through actually matters — without it the
    // server would default phase to "plan" and disagree with the borrowed status.
    expect(first.phase).not.toBe("plan");

    fireEvent.click(screen.getByRole("button", { name: /new work item/i }));

    // The unscoped New passes team_id, status_id, department, AND phase from the
    // SAME first item as one ATOMIC quadruple (a status belongs to a team) —
    // mirroring the mock's workItems[0] backfill and the scoped #104 fix, so the
    // real API's required status_id is satisfied instead of POSTing a bare {} the
    // backend rejects, and the borrowed status_id stays aligned with its phase.
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        team_id: first.team_id,
        status_id: first.status_id,
        department: first.department,
        phase: first.phase,
      });
    });
  });

  it("still calls create({}) on an empty board — nothing to derive, button stays usable", async () => {
    const base = createMockWorkItemRepository();
    const createSpy = vi.fn((input: CreateWorkItemInput) => base.create(input));
    // Drain the fixture store so the loaded list is empty: there is no first item
    // to derive defaults from, so the fallback must POST a bare {} (the server
    // resolves the team default) instead of throwing or disabling the button.
    const repository = {
      ...base,
      list: () => Promise.resolve([]),
      create: createSpy,
    };

    render(<WorkboardScreen repository={repository} />);

    // The teaching empty state renders (no rows); its CTA can still create.
    expect(await screen.findByText("No work items yet")).toBeInTheDocument();
    // Both the toolbar control and the empty-state CTA read "New work item";
    // clicking either routes through the same handler without throwing.
    const newButtons = screen.getAllByRole("button", {
      name: /new work item/i,
    });
    expect(() => fireEvent.click(newButtons[0])).not.toThrow();

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({});
    });
  });

  it("surfaces a failed create with a toast instead of silently swallowing it", async () => {
    // The trailing .catch on handleNewItem previously swallowed every create
    // rejection — so a prod create failure (e.g. a rejected payload) was
    // invisible (CodeRabbit WorkboardScreen.tsx:474). It must now be announced.
    const base = createMockWorkItemRepository();
    const failing = {
      ...base,
      create: () => Promise.reject(new Error("backend down")),
    };
    renderScreenWithToaster(failing);

    await waitFor(() => {
      expect(screen.getAllByTestId("work-item-row").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /new work item/i }));

    // The failure is announced (no more silent .catch swallow) and no editor
    // opens on a non-existent item.
    expect(await screen.findByText(/couldn't create/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the New button while the initial load is pending, then enables it once items land", async () => {
    const base = createMockWorkItemRepository();
    // Hold the initial list load open so the screen stays in its loading state:
    // while loading, `items` is empty, so a New click would derive NO defaults
    // even on a non-empty board and POST a bare payload the prod API rejects
    // (Codex review, PR #105). The button must be disabled until the load lands.
    let resolveList:
      | ((items: Awaited<ReturnType<typeof base.list>>) => void)
      | undefined;
    const pending = new Promise<Awaited<ReturnType<typeof base.list>>>(
      (resolve) => {
        resolveList = resolve;
      },
    );
    const repository = { ...base, list: () => pending };

    render(<WorkboardScreen repository={repository} />);

    // While the list load is pending, the toolbar New button is disabled.
    const newButton = await screen.findByRole("button", {
      name: /new work item/i,
    });
    expect(newButton).toBeDisabled();

    // Resolve the load with the real fixtures; the button enables once the data
    // the derivation reads has actually loaded.
    resolveList?.(await base.list());

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /new work item/i }),
      ).toBeEnabled();
    });
  });

  it("keeps the New button disabled when the initial load fails", async () => {
    const base = createMockWorkItemRepository();
    // The list load rejects: the hook clears `loading` and sets `error`, but
    // `items` stays empty — the board is NOT known-empty, so New must stay
    // disabled rather than re-enable and post a bare create({}) against a real
    // backend (CodeRabbit review, PR #105).
    const repository = {
      ...base,
      list: () => Promise.reject(new Error("backend down")),
    };

    render(<WorkboardScreen repository={repository} />);

    // Once the load settles into the error state, the toolbar New button is
    // disabled and stays that way (no successful load ever establishes the board).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /new work item/i }),
      ).toBeDisabled();
    });
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
      name: "Status for Workspace auth hardening",
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
        name: "Status for Workspace auth hardening",
      }),
    ).toHaveTextContent(/execute/i);
    // The succeeded rows did persist to the store.
    const items = await repository.list();
    expect(items.find((item) => item.id === "wi_realtime")?.phase).toBe("done");
  });

  it("restores persisted search, groupBy, and visibleColumns from localStorage", async () => {
    const base = defaultWorkboardFilterState();
    // Hide the Tags column and group by Type instead of the default Team.
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
    // groupBy restored → swimlanes are by Type ("Feature"), not Team.
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
      screen.getByRole("button", { name: "Filter Status (1)" }),
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
    fireEvent.keyDown(screen.getByRole("button", { name: "Filter Status" }), {
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
    fireEvent.click(await screen.findByRole("menuitem", { name: "Auth only" }));

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
      await screen.findByRole("menuitem", { name: "Delete view Auth only" }),
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
      await screen.findByRole("menuitem", { name: "Restored lane" }),
    ).toBeInTheDocument();
  });
});

describe("WorkboardScreen repository selection", () => {
  it("uses the context (network) repository when no repository prop is given", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <ThemeProvider defaultTheme="light">
          <RepositoryProvider>
            <WorkboardScreen />
          </RepositoryProvider>
        </ThemeProvider>,
      );
      // The provider's network repo fetches the API on mount; the mock never
      // would — this is exactly the regression the fix closes.
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/api/work-items"),
          expect.anything(),
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
