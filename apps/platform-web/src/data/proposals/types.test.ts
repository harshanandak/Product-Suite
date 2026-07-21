import { describe, expect, it } from "vitest";

import type { AcceptResult, Proposal, ProposalSource } from "./types";

/**
 * Types-only module: these tests pin the CONTRACT shape (they compile-check the
 * real backend fields) and document how the discriminated `AcceptResult` narrows.
 */
describe("proposal types", () => {
  it("a create Proposal has a null target_id", () => {
    const proposal: Proposal = {
      id: "p1",
      target_type: "work_item",
      target_id: null,
      operation: "create",
      payload: { title: "X" },
      rationale: "because",
      confidence: 0.9,
      status: "pending",
      run_id: "r1",
      model_id: "m1",
      source: "chat",
      created_at: "2026-07-13T00:00:00.000Z",
    };
    expect(proposal.target_id).toBeNull();
    expect(proposal.operation).toBe("create");
    expect(proposal.source).toBe("chat");
  });

  it("source is one of the three provenance literals or null", () => {
    // The field is nullable (the backend may omit it / send something unknown).
    const sources: (ProposalSource | null)[] = [
      "chat",
      "autonomous",
      "connector",
      null,
    ];
    expect(sources).toHaveLength(4);
    expect(sources).toContain("autonomous");
    expect(sources).toContain(null);
  });

  it("AcceptResult narrows by its status discriminant", () => {
    const results: AcceptResult[] = [
      { status: "applied", proposal_id: "p1", item_id: "wi_1" },
      { status: "stale", proposal_id: "p1", item_id: "wi_1", message: "changed" },
      { status: "invalid", proposal_id: "p1", message: "bad", retryable: true },
    ];
    const applied = results.find((r) => r.status === "applied");
    expect(applied && "item_id" in applied).toBe(true);
    const invalid = results.find((r) => r.status === "invalid");
    expect(invalid && "item_id" in invalid).toBe(false);
  });
});
