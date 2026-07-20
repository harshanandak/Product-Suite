import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AcceptResult } from "@/data/proposals";

// ProposalCard now navigates programmatically (no <Link>) and disposes proposals
// through useProposalActions. Mock both seams so the card renders standalone and
// its wiring is assertable without a router or a live repository.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// A controllable useProposalActions: each test sets `actions.current` before
// rendering to drive the card's phase/result and to spy on accept/reject.
const actions = vi.hoisted(() => ({
  current: null as unknown,
}));
vi.mock("@/data/proposals", () => ({
  useProposalActions: () => actions.current,
}));

import { ProposalCard } from "./ProposalCard";

function makeActions(
  overrides: Partial<{
    phase: "idle" | "applying" | "settled" | "rejected";
    result: AcceptResult | null;
    busy: boolean;
    error: string | null;
    accept: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    phase: "idle" as const,
    result: null,
    busy: false,
    error: null,
    accept: vi.fn(),
    reject: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

describe("ProposalCard (inline actions)", () => {
  const data = {
    operation: "create" as const,
    proposalId: "p_1",
    title: "Ship auth",
    summary: "The user asked for it.",
  };

  it("renders the badge, title, summary, pending pill, and INLINE Accept/Edit/Discard", () => {
    actions.current = makeActions();
    render(<ProposalCard data={data} workspace="befach-hq" />);
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Ship auth")).toBeInTheDocument();
    expect(screen.getByText("The user asked for it.")).toBeInTheDocument();
    expect(screen.getByText("Pending review")).toBeInTheDocument();
    // The proposal is now ACTIONABLE IN PLACE — the inline affordance is present.
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("the Accept button uses the primary (indigo) style, NOT the success/green style", () => {
    actions.current = makeActions();
    render(<ProposalCard data={data} workspace="befach-hq" />);
    const accept = screen.getByRole("button", { name: "Accept" });
    // Regression guard: the earlier draft styled Accept green (bg-success); the
    // design system's primary is indigo, so no success class may leak in.
    expect(accept.className).not.toMatch(/success/);
  });

  it("Accept disposes the proposal in place (calls accept, no navigation)", () => {
    const accept = vi.fn();
    actions.current = makeActions({ accept });
    render(<ProposalCard data={data} workspace="befach-hq" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("no longer shows a 'Review in Inbox' link (inline is the primary surface)", () => {
    actions.current = makeActions();
    render(<ProposalCard data={data} workspace="befach-hq" />);
    expect(
      screen.queryByRole("link", { name: /Review in Inbox/ }),
    ).not.toBeInTheDocument();
  });

  it("applied → shows 'Applied.' and a View item action that navigates to the item", () => {
    actions.current = makeActions({
      phase: "settled",
      result: { status: "applied", proposal_id: "p_1", item_id: "wi_1" },
    });
    render(<ProposalCard data={data} workspace="befach-hq" />);
    expect(screen.getByText("Applied.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View item/ }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/w/$workspace/workboard/item/$itemId",
      params: { workspace: "befach-hq", itemId: "wi_1" },
    });
  });

  it("invalid + non-retryable → terminal Discard-only (no dead Retry/Edit)", () => {
    actions.current = makeActions({
      phase: "settled",
      result: {
        status: "invalid",
        proposal_id: "p_1",
        message: "The team no longer exists.",
        retryable: false,
      },
    });
    render(<ProposalCard data={data} workspace="befach-hq" />);
    expect(screen.getByText("The team no longer exists.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("labels an update card with the Update badge", () => {
    actions.current = makeActions();
    render(
      <ProposalCard
        data={{ ...data, operation: "update" }}
        workspace="befach-hq"
      />,
    );
    expect(screen.getByText("Update")).toBeInTheDocument();
  });
});
