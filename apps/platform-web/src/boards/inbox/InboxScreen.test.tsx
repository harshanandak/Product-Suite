import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProposalRepository } from "@/data/proposals";
import type { AcceptResult, Proposal } from "@/data/proposals";

// Mutable search stub so a test can drive the `?proposal=<id>` deep-link.
let searchMock: { proposal?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ workspace: "acme" }),
  useSearch: () => searchMock,
  // The detail pane renders TanStack Link; stub it as a plain anchor (drop the
  // router-only `to`/`params` props so they don't hit the DOM).
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: {
    children: ReactNode;
    to?: string;
    params?: Record<string, string>;
  } & Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// The detail pane fetches its update target through the work-items hook; stub it.
vi.mock("@/data/work-items", () => ({
  useWorkItems: () => ({ items: [] }),
}));

import { InboxScreen } from "./InboxScreen";

function proposal(id: string, title: string): Proposal {
  return {
    id,
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title },
    rationale: `Rationale for ${title}`,
    confidence: 0.7,
    status: "pending",
    run_id: "r1",
    model_id: "m1",
    created_at: "2026-07-13T09:12:00.000Z",
  };
}

function repoWith(proposals: Proposal[]): ProposalRepository {
  return {
    list: vi.fn(async () => proposals),
    accept: vi.fn(async (): Promise<AcceptResult> => ({ outcome: "stale" })),
    reject: vi.fn(async () => undefined),
  };
}

describe("InboxScreen", () => {
  beforeEach(() => {
    searchMock = {};
  });

  it("renders a list row per pending proposal", async () => {
    render(
      <InboxScreen
        repository={repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")])}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("2 pending")).toBeInTheDocument();
  });

  it("shows the empty state when there are no proposals", async () => {
    render(<InboxScreen repository={repoWith([])} />);
    await waitFor(() =>
      expect(screen.getByText("No proposals to review")).toBeInTheDocument(),
    );
  });

  it("shows the error surface when the load fails", async () => {
    const repository = repoWith([]);
    repository.list = vi.fn(async () => {
      throw new Error("boom");
    });
    render(<InboxScreen repository={repository} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("selects the first proposal by default and swaps detail on row click", async () => {
    render(
      <InboxScreen
        repository={repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")])}
      />,
    );
    // Default selection → Alpha's detail sentence is shown.
    await waitFor(() =>
      expect(
        screen.getByText("Create work item “Alpha”"),
      ).toBeInTheDocument(),
    );

    // Clicking Beta's row swaps the detail pane to Beta.
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(screen.getByText("Create work item “Beta”")).toBeInTheDocument();
  });

  it("preselects the deep-linked proposal from ?proposal=<id>", async () => {
    searchMock = { proposal: "p2" };
    render(
      <InboxScreen
        repository={repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")])}
      />,
    );
    // The requested proposal (Beta), not the first row (Alpha), owns the pane.
    await waitFor(() =>
      expect(screen.getByText("Create work item “Beta”")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Create work item “Alpha”"),
    ).not.toBeInTheDocument();
  });

  it("falls back to the first proposal when the deep-linked id is not pending", async () => {
    searchMock = { proposal: "gone" };
    render(
      <InboxScreen
        repository={repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")])}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Create work item “Alpha”")).toBeInTheDocument(),
    );
  });

  it("retargets the pane when a new ?proposal deep-link arrives while already open", async () => {
    // The inbox is already open on the default (first) row; then the chat panel's
    // "Review in Inbox →" changes the search param to a DIFFERENT proposal.
    const repository = repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")]);
    const { rerender } = render(<InboxScreen repository={repository} />);
    await waitFor(() =>
      expect(screen.getByText("Create work item “Alpha”")).toBeInTheDocument(),
    );

    searchMock = { proposal: "p2" };
    rerender(<InboxScreen repository={repository} />);

    // The pane jumps to Beta even though Alpha was already selected.
    await waitFor(() =>
      expect(screen.getByText("Create work item “Beta”")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Create work item “Alpha”"),
    ).not.toBeInTheDocument();
  });

  it("ignores a row swap while an accept is in flight (keeps the acted-on pane)", async () => {
    let resolveAccept: (result: AcceptResult) => void = () => {};
    const repository = repoWith([proposal("p1", "Alpha"), proposal("p2", "Beta")]);
    // A never-auto-resolving accept keeps isMutating true across the swap attempt.
    repository.accept = vi.fn(
      () =>
        new Promise<AcceptResult>((resolve) => {
          resolveAccept = resolve;
        }),
    );
    render(<InboxScreen repository={repository} />);
    await waitFor(() =>
      expect(screen.getByText("Create work item “Alpha”")).toBeInTheDocument(),
    );

    // Start an accept on Alpha → the pending mutation holds isMutating true.
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(repository.accept).toHaveBeenCalledTimes(1));

    // Attempt to jump to Beta mid-mutation — the pane must stay on Alpha.
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(screen.getByText("Create work item “Alpha”")).toBeInTheDocument();
    expect(
      screen.queryByText("Create work item “Beta”"),
    ).not.toBeInTheDocument();

    // Resolve so the disposition settles (flushes state before teardown).
    resolveAccept({ outcome: "stale" });
    await waitFor(() =>
      expect(
        screen.getByText(/no longer pending/),
      ).toBeInTheDocument(),
    );
  });
});
