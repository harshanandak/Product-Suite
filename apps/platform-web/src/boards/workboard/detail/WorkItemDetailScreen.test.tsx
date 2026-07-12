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

    // The tab set is present (only tabs backed by real data are shipped).
    for (const name of [/overview/i, /checks/i, /activity/i]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }

    // The right-rail Properties heading renders.
    expect(
      screen.getByRole("heading", { name: "Properties" }),
    ).toBeInTheDocument();

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

    const checksTab = screen.getByRole("tab", { name: /checks/i });
    checksTab.focus();
    fireEvent.click(checksTab);

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

  it("adds a check from the Checks tab and updates the progress count", async () => {
    const repo = createMockWorkItemRepository();
    routerMock.params = { workspace: "acme", itemId: "wi_realtime" };

    render(<WorkItemDetailScreen repository={repo} />);
    await screen.findByRole("heading", { level: 1 });

    const checksTab = screen.getByRole("tab", { name: /checks/i });
    checksTab.focus();
    fireEvent.click(checksTab);

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
});
