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
  it("shows the directive, applies-when, and active-voice evidence count", () => {
    render(
      <RuleProposalSurface proposal={ruleProposal()} onStrengthChange={vi.fn()} />,
    );
    expect(screen.getByText(/The agent wants to learn a rule/i)).toBeInTheDocument();
    // The directive + applies-when each appear twice (the rule statement AND the
    // plain-language "From now on…" effect line that restates them).
    expect(screen.getAllByText(/Prefer concise titles/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/work items in project Foo/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/You made this same edit 3 times/i),
    ).toBeInTheDocument();
  });

  it("lists the source edits when the evidence disclosure is expanded", () => {
    render(
      <RuleProposalSurface proposal={ruleProposal()} onStrengthChange={vi.fn()} />,
    );
    // Collapsed by default — the ids are not shown until disclosed.
    expect(screen.queryByText("p2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show the 3 times/i }));
    expect(screen.getByText("p1")).toBeInTheDocument();
    expect(screen.getByText("p2")).toBeInTheDocument();
    expect(screen.getByText("p3")).toBeInTheDocument();
  });

  it("warns loudly when the rule has NO conditions (applies everywhere)", () => {
    render(
      <RuleProposalSurface
        proposal={ruleProposal({ attrs: { evidence_proposal_ids: [] } })}
        onStrengthChange={vi.fn()}
      />,
    );
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/Applies everywhere/i);
    expect(warning).toHaveTextContent(/no\s+conditions/i);
    // The scary case is NOT the old muted "any context" afterthought.
    expect(screen.queryByText(/any context/i)).not.toBeInTheDocument();
  });

  it("emits { enforcement: 'hard' } when the reviewer picks 'Always follow'", () => {
    const onStrengthChange = vi.fn<(s: RuleStrength) => void>();
    render(
      <RuleProposalSurface
        proposal={ruleProposal()}
        onStrengthChange={onStrengthChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /always follow/i }));
    expect(onStrengthChange).toHaveBeenCalledWith({
      enforcement: "hard",
      pinned: false,
    });
  });

  it("emits { enforcement: 'advisory' } when the reviewer picks 'Suggestion'", () => {
    const onStrengthChange = vi.fn<(s: RuleStrength) => void>();
    render(
      <RuleProposalSurface
        proposal={ruleProposal({ enforcement: "hard" })}
        onStrengthChange={onStrengthChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^suggestion/i }));
    expect(onStrengthChange).toHaveBeenCalledWith({
      enforcement: "advisory",
      pinned: false,
    });
  });

  it("emits pinned: true when the reviewer prioritizes it", () => {
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
