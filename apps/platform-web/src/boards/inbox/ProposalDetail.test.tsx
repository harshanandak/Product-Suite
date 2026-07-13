import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AcceptResult, Proposal } from "@/data/proposals";

// The detail fetches the update target through the work-items hook; stub it with
// a controlled item set so the diff/sentence are deterministic.
const itemsMock = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/data/work-items", () => ({
  useWorkItems: () => ({ items: itemsMock.items }),
}));

import { ProposalDetail } from "./ProposalDetail";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title: "Ship pricing brief" },
    rationale: "Both calls surfaced pricing objections.",
    confidence: 0.82,
    status: "pending",
    run_id: "r1",
    model_id: "kimi-k2.5",
    created_at: "2026-07-13T09:12:00.000Z",
    ...overrides,
  };
}

function renderDetail(p: Proposal, over: Partial<Record<string, unknown>> = {}) {
  const accept = vi.fn(
    async (): Promise<AcceptResult> => ({ outcome: "stale" }),
  );
  const reject = vi.fn(async () => undefined);
  render(
    <ProposalDetail
      proposal={p}
      accept={over.accept as never ?? accept}
      reject={reject}
      isMutating={false}
      workspace="acme"
    />,
  );
  return { accept, reject };
}

describe("ProposalDetail (scaffold)", () => {
  it("shows the create operation sentence and the rationale", () => {
    renderDetail(proposal());
    expect(screen.getByText("Create work item “Ship pricing brief”")).toBeInTheDocument();
    expect(
      screen.getByText("Both calls surfaced pricing objections."),
    ).toBeInTheDocument();
  });

  it("Accept and Reject call the mutations", () => {
    const { accept, reject } = renderDetail(proposal());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(reject).toHaveBeenCalledWith("p1");
  });
});
