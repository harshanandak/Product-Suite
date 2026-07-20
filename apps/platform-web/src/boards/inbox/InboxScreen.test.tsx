import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProposalRepository } from "@/data/proposals";
import type { AcceptResult, Proposal } from "@/data/proposals";
import type { WorkItem } from "@/data/work-items";

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
    activeRules: vi.fn(async () => []),
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
    // Scope title lookups to the LIST: the default-selected proposal's detail
    // pane also renders its title as a field value, so an unscoped getByText
    // would race a second "Alpha" match once the pane's rows mount.
    const list = screen.getByRole("list", { name: "Pending proposals" });
    expect(within(list).getByText("Alpha")).toBeInTheDocument();
    expect(within(list).getByText("Beta")).toBeInTheDocument();
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
      expect(screen.getByText("This item changed")).toBeInTheDocument(),
    );
  });

  it("keeps the terminal Applied → View item banner across the whole accept→refetch→empty sequence for the LAST proposal", async () => {
    // The single-proposal case, modelling the FULL invalidate-on-settle sequence:
    // accept applies → the hook refetches → that reload is in flight (previously
    // this flipped `isLoading`, swapping a skeleton in and unmounting the pane —
    // a SECOND discard path beyond the empty-guard) → the reload returns an empty
    // pending list. The terminal "Applied → View item" banner (cached via seenRef)
    // must survive EVERY step: it stays mounted while the refetch runs (no
    // skeleton) and after the list empties (no "No proposals" state). (kernel 7218a03e)
    const only = proposal("p1", "Alpha");
    const repository = repoWith([only]);
    // The invalidate-on-settle refetch is held OPEN so we can assert the banner
    // survives WHILE the reload is in flight, not just after it resolves.
    let resolveRefetch: (proposals: Proposal[]) => void = () => {};
    let listCalls = 0;
    repository.list = vi.fn(() =>
      listCalls++ === 0
        ? Promise.resolve([only])
        : new Promise<Proposal[]>((resolve) => {
            resolveRefetch = resolve;
          }),
    );
    repository.accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        outcome: "applied",
        item: { id: "wi_1" } as WorkItem,
      }),
    );

    render(<InboxScreen repository={repository} />);
    await waitFor(() =>
      expect(screen.getByText("Create work item “Alpha”")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    // Step 1 — accept has applied and the refetch is STILL in flight. The banner
    // is up and the pane must stay mounted: no full skeleton flips in mid-refetch.
    // (This file's Link mock renders an href-less anchor, so assert on the banner
    // text rather than an implicit link role.)
    await waitFor(() =>
      expect(screen.getAllByText(/View item/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/Applied\./)).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading proposals"),
    ).not.toBeInTheDocument();
    expect(repository.list).toHaveBeenCalledTimes(2);

    // Step 2 — the reload settles to an EMPTY pending list. The inbox does NOT
    // blank to the empty state; the terminal confirmation persists.
    resolveRefetch([]);
    await waitFor(() => expect(screen.getByText("0 pending")).toBeInTheDocument());
    expect(screen.getByText(/Applied\./)).toBeInTheDocument();
    expect(screen.getAllByText(/View item/i).length).toBeGreaterThan(0);
    expect(
      screen.queryByText("No proposals to review"),
    ).not.toBeInTheDocument();
  });
});
