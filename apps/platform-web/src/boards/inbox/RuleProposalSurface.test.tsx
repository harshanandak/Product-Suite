import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Proposal } from "@/data/proposals";

import { RuleProposalSurface, type RuleStrength } from "./RuleProposalSurface";

function ruleProposal(overrides: Record<string, unknown> = {}): Proposal {
  return {
    id: "p_rule",
    target_type: "memory",
    target_id: null,
    operation: "create",
    payload: {
      kind: "rule",
      title: "Prefer concise titles",
      attrs: {
        applies_when: "work items in project Foo",
        evidence_proposal_ids: ["p1", "p2", "p3"],
      },
      enforcement: "advisory",
      ...overrides,
    },
    rationale: "Recurring correction across three runs.",
    confidence: 0.9,
    status: "pending",
    run_id: "run_1",
    model_id: "kimi-k2.5",
    created_at: "2026-07-13T09:12:00.000Z",
  } as Proposal;
}

describe("RuleProposalSurface", () => {
  it("shows the directive, applies-when, and 'changed N×' evidence", () => {
    render(
      <RuleProposalSurface proposal={ruleProposal()} onStrengthChange={vi.fn()} />,
    );
    expect(screen.getByText(/Prefer concise titles/)).toBeInTheDocument();
    expect(screen.getByText(/work items in project Foo/)).toBeInTheDocument();
    expect(screen.getByText(/changed 3×/i)).toBeInTheDocument();
  });

  it("falls back to 'any context' when applies_when is absent", () => {
    render(
      <RuleProposalSurface
        proposal={ruleProposal({ attrs: { evidence_proposal_ids: [] } })}
        onStrengthChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/any context/i)).toBeInTheDocument();
    expect(screen.getByText(/changed 0×/i)).toBeInTheDocument();
  });

  it("emits { enforcement: 'hard' } when the reviewer marks it hard", () => {
    const onStrengthChange = vi.fn<(s: RuleStrength) => void>();
    render(
      <RuleProposalSurface
        proposal={ruleProposal()}
        onStrengthChange={onStrengthChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /mark as hard/i }));
    expect(onStrengthChange).toHaveBeenCalledWith({
      enforcement: "hard",
      pinned: false,
    });
  });

  it("emits pinned: true when the reviewer pins it", () => {
    const onStrengthChange = vi.fn<(s: RuleStrength) => void>();
    render(
      <RuleProposalSurface
        proposal={ruleProposal()}
        onStrengthChange={onStrengthChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onStrengthChange).toHaveBeenCalledWith({
      enforcement: "advisory",
      pinned: true,
    });
  });
});
