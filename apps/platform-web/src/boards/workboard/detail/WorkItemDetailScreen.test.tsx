import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    for (const name of [/overview/i, /tasks/i, /activity/i]) {
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
});
