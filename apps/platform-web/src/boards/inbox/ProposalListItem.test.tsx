import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Proposal } from "@/data/proposals";

import { ProposalListItem } from "./ProposalListItem";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title: "Draft pricing brief" },
    rationale: null,
    confidence: 0.82,
    status: "pending",
    run_id: "r1",
    model_id: "kimi-k2.5",
    created_at: "2026-07-13T09:12:00.000Z",
    ...overrides,
  };
}

describe("ProposalListItem", () => {
  it("renders the title, operation, model and confidence", () => {
    render(
      <ProposalListItem proposal={proposal()} selected={false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Draft pricing brief")).toBeInTheDocument();
    expect(screen.getByText("create")).toBeInTheDocument();
    expect(screen.getByText("kimi-k2.5")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
  });

  it("hides the confidence badge when unscored", () => {
    render(
      <ProposalListItem
        proposal={proposal({ confidence: null })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("Model confidence")).not.toBeInTheDocument();
  });

  it("fires onSelect with the id and reflects selection via aria-pressed", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ProposalListItem proposal={proposal()} selected={false} onSelect={onSelect} />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("p1");

    rerender(
      <ProposalListItem proposal={proposal()} selected onSelect={onSelect} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});
