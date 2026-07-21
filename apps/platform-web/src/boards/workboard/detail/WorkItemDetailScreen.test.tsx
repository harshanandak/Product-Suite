import type { ReactNode } from "react";

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createMockWorkItemRepository } from "@/data/work-items/repository";
import type { WorkItemRepository } from "@/data/work-items";

// Drive the route param and neutralize <Link> so the screen can be exercised
// without spinning up a full RouterProvider. A hoisted holder lets each test set
// the active itemId before render.
const routerMock = vi.hoisted(() => ({
  params: {} as { workspace?: string; itemId?: string },
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => routerMock.params,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

import { WorkItemDetailScreen } from "./WorkItemDetailScreen";

// Radix (Tabs / Sheet) needs pointer + scroll APIs jsdom omits — stub them so
// tab activation and focus management work under the test environment.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

describe("WorkItemDetailScreen", () => {
  it("renders a work item's header, tab set and properties from real data", async () => {
    const repo: WorkItemRepository = createMockWorkItemRepository();
    const items = await repo.list();
    const first = items[0];
    expect(first).toBeDefined();
    routerMock.params = { workspace: "acme", itemId: first!.id };

    render(<WorkItemDetailScreen repository={repo} />);

    // Header title resolves once the async load settles.
    expect(
      await screen.findByRole("heading", { level: 1, name: first!.title }),
    ).toBeInTheDocument();

    // Checks were promoted onto the Overview module (§C), so the tab set is now
    // Overview · Activity; the standalone Checks tab is gone.
    for (const name of [/overview/i, /activity/i]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: /checks/i })).toBeNull();

    // The right-rail Properties heading renders.
    expect(
      screen.getByRole("heading", { name: "Properties" }),
    ).toBeInTheDocument();

    // The team + status property rows use the renamed labels (were Department
    // and Phase); the underlying department / phase fields are unchanged.
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();

    // The Edit affordance is present (opens the quick-edit Sheet).
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();

    // The Overview renders the item's real description from the seed.
    expect(first!.description).toBeTruthy();
    expect(screen.getByText(first!.description!)).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown item id", async () => {
    const repo = createMockWorkItemRepository();
    routerMock.params = { workspace: "acme", itemId: "does-not-exist" };

    render(<WorkItemDetailScreen repository={repo} />);

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it("renders the item's activity log in the Activity tab", async () => {
    const repo: WorkItemRepository = createMockWorkItemRepository();
    const items = await repo.list();
    const first = items[0];
    const events = await repo.listActivity(first!.id);
    expect(events.length).toBeGreaterThan(0);
    routerMock.params = { workspace: "acme", itemId: first!.id };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1, name: first!.title });

    // Switch to the Activity tab (Radix auto-activates on focus) and see a
    // real, seeded event.
    const activityTab = screen.getByRole("tab", { name: /activity/i });
    activityTab.focus();
    fireEvent.click(activityTab);
    expect(await screen.findByText(events[0]!.summary)).toBeInTheDocument();
  });

  it("checks off a check, advancing it around the status triad (move ②)", async () => {
    const repo = createMockWorkItemRepository();
    // wi_realtime seeds t_rt_2 "Define RealtimeTransport" as a "todo" check.
    routerMock.params = { workspace: "acme", itemId: "wi_realtime" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1 });

    // Checks render on the Overview (the default tab) — no tab switch needed.
    const checkbox = await screen.findByLabelText(
      "Advance status of Define RealtimeTransport",
    );
    const row = checkbox.closest("li");
    expect(row).not.toBeNull();
    // Seeds as To-do.
    expect(within(row!).getByText("To-do")).toBeInTheDocument();

    fireEvent.click(checkbox);

    // One toggle advances todo → in_progress (persisted through the repo).
    await waitFor(() => {
      expect(within(row!).getByText("In progress")).toBeInTheDocument();
    });
    const persisted = await repo.getChecks("wi_realtime");
    expect(
      persisted.find((check) => check.id === "t_rt_2")?.status,
    ).toBe("in_progress");
  });

  it("adds a check from the Overview Checks module and updates the progress count", async () => {
    const repo = createMockWorkItemRepository();
    routerMock.params = { workspace: "acme", itemId: "wi_realtime" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1 });

    // The writable Checks module lives on the Overview (default tab).
    const input = await screen.findByLabelText("New check title");
    fireEvent.change(input, { target: { value: "Wire the transport stub" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // The new check appears in the list…
    expect(
      await screen.findByText("Wire the transport stub"),
    ).toBeInTheDocument();
    // …and it was persisted through the repository.
    await waitFor(async () => {
      const persisted = await repo.getChecks("wi_realtime");
      expect(
        persisted.some((check) => check.title === "Wire the transport stub"),
      ).toBe(true);
    });
  });

  it("renders the parent's child Tasks with an n/m progress on the Overview", async () => {
    const repo = createMockWorkItemRepository();
    // wi_auth seeds three child Tasks (2 done, 1 in execute) → a 2/3 rollup.
    routerMock.params = { workspace: "acme", itemId: "wi_auth" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1, name: "Workspace auth hardening" });

    // The child Tasks render (as links to their own detail pages)…
    expect(await screen.findByText("Draft new intake form")).toBeInTheDocument();
    expect(screen.getByText("Migrate legacy records")).toBeInTheDocument();
    expect(screen.getByText("Cutover + verify")).toBeInTheDocument();
    // …under a Tasks module heading with the correct n/m fraction.
    expect(screen.getByRole("heading", { name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("adds a child Task inline and it appears in the Tasks module (with parent set)", async () => {
    const repo = createMockWorkItemRepository();
    routerMock.params = { workspace: "acme", itemId: "wi_auth" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1, name: "Workspace auth hardening" });

    const input = await screen.findByLabelText("New task title");
    fireEvent.change(input, { target: { value: "Rotate signing keys" } });
    fireEvent.click(screen.getByRole("button", { name: /add task/i }));

    // The new Task appears in the module…
    expect(await screen.findByText("Rotate signing keys")).toBeInTheDocument();
    // …and it was persisted as a child of wi_auth (parent_id set, depth derived,
    // and it inherits the parent's team so multi-team tenants resolve correctly).
    await waitFor(async () => {
      const list = await repo.list();
      const created = list.find((item) => item.title === "Rotate signing keys");
      const parent = list.find((item) => item.id === "wi_auth");
      expect(created?.parent_id).toBe("wi_auth");
      expect(created?.depth).toBe(1);
      expect(created?.team_id).toBe(parent?.team_id);
    });
  });

  it("hides the Tasks module + Add-task form on a Task's own detail (no tasks-of-tasks)", async () => {
    const repo = createMockWorkItemRepository();
    // wi_auth_cutover is itself a Task (parent_id set); one-level nesting means it
    // cannot own sub-tasks, so no Tasks module and no create path are rendered.
    routerMock.params = { workspace: "acme", itemId: "wi_auth_cutover" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1, name: "Cutover + verify" });

    expect(screen.queryByRole("heading", { name: /^tasks$/i })).toBeNull();
    expect(screen.queryByLabelText("New task title")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add task/i }),
    ).toBeNull();
  });

  it("shows a parent breadcrumb on a child Task's detail", async () => {
    const repo = createMockWorkItemRepository();
    // wi_auth_cutover is a child of wi_auth.
    routerMock.params = { workspace: "acme", itemId: "wi_auth_cutover" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1, name: "Cutover + verify" });

    // The parent's title renders as a breadcrumb crumb (a link back to it).
    expect(
      await screen.findByRole("link", { name: "Workspace auth hardening" }),
    ).toBeInTheDocument();
  });
});
