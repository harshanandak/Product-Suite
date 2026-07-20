import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptResult, Proposal } from "@/data/proposals";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Controllable proposals list.
const proposalsState = vi.hoisted(() => ({
  current: {
    proposals: [] as Proposal[],
    isLoading: false,
  },
}));

// A useProposalActions stub that keeps a STABLE accept spy per proposal and
// captures each row's `onSettled` so a test can fire a terminal outcome and
// assert the header count drops.
const actionState = vi.hoisted(() => ({
  accepts: new Map<string, ReturnType<typeof vi.fn>>(),
  settle: new Map<string, (result: AcceptResult | "rejected") => void>(),
}));

vi.mock("@/data/proposals", () => ({
  useProposals: () => proposalsState.current,
  useProposalActions: (
    id: string,
    opts?: { onSettled?: (result: AcceptResult | "rejected") => void },
  ) => {
    if (opts?.onSettled) actionState.settle.set(id, opts.onSettled);
    let accept = actionState.accepts.get(id);
    if (!accept) {
      accept = vi.fn();
      actionState.accepts.set(id, accept);
    }
    return {
      phase: "idle" as const,
      result: null,
      busy: false,
      error: null,
      accept,
      reject: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

import { ChatPendingSection } from "./ChatPendingSection";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    target_type: "work_item",
    target_id: null,
    operation: "update",
    payload: { title: "Checkout flow bug" },
    rationale: null,
    confidence: null,
    status: "pending",
    run_id: "run_1",
    model_id: "kimi",
    created_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  actionState.accepts.clear();
  actionState.settle.clear();
  proposalsState.current = { proposals: [], isLoading: false };
});

describe("ChatPendingSection", () => {
  it("renders nothing when there are no pending proposals (quiet backstop)", () => {
    proposalsState.current = { proposals: [], isLoading: false };
    const { container } = render(<ChatPendingSection workspace="acme" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the list is still loading", () => {
    proposalsState.current = { proposals: [proposal()], isLoading: true };
    const { container } = render(<ChatPendingSection workspace="acme" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the header with the pending count and a row per proposal", () => {
    proposalsState.current = {
      proposals: [
        proposal({ id: "p1", payload: { title: "Checkout flow bug" } }),
        proposal({
          id: "p2",
          target_type: "memory",
          operation: "create",
          payload: {},
        }),
      ],
      isLoading: false,
    };
    render(<ChatPendingSection workspace="acme" />);
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // Row identity: operation verb + title (memory with no title → a label, never a uuid).
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Checkout flow bug")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Memory note")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);
  });

  it("collapsing the header hides the rows (count stays visible)", () => {
    proposalsState.current = { proposals: [proposal()], isLoading: false };
    render(<ChatPendingSection workspace="acme" />);
    expect(screen.getByText("Checkout flow bug")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Pending review/ }));
    expect(screen.queryByText("Checkout flow bug")).not.toBeInTheDocument();
    // The count remains the source of truth in the collapsed header.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("accepting a row disposes it in place (calls that row's accept)", () => {
    proposalsState.current = { proposals: [proposal({ id: "p1" })], isLoading: false };
    render(<ChatPendingSection workspace="acme" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(actionState.accepts.get("p1")).toHaveBeenCalledTimes(1);
  });

  it("a TERMINAL applied outcome drops the pending count; a stale one does not", () => {
    proposalsState.current = {
      proposals: [proposal({ id: "p1" }), proposal({ id: "p2" })],
      isLoading: false,
    };
    render(<ChatPendingSection workspace="acme" />);
    expect(screen.getByText("2")).toBeInTheDocument();

    // A stale outcome stays counted (still recoverable / pending).
    act(() =>
      actionState.settle.get("p1")!({
        status: "stale",
        proposal_id: "p1",
        item_id: "wi_1",
        message: "changed",
      }),
    );
    expect(screen.getByText("2")).toBeInTheDocument();

    // An applied outcome is terminal → the count drops to 1.
    act(() =>
      actionState.settle.get("p1")!({
        status: "applied",
        proposal_id: "p1",
        item_id: "wi_1",
      }),
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
