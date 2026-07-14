import { describe, expect, it } from "vitest";

import type { AcceptResult, Proposal } from "./types";

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
      created_at: "2026-07-13T00:00:00.000Z",
    };
    expect(proposal.target_id).toBeNull();
    expect(proposal.operation).toBe("create");
  });

  it("AcceptResult narrows by its outcome discriminant", () => {
    const results: AcceptResult[] = [
      { outcome: "applied", item: { id: "wi_1", title: "T" } as never },
      { outcome: "stale" },
      { outcome: "invalid" },
    ];
    const applied = results.find((r) => r.outcome === "applied");
    expect(applied && "item" in applied).toBe(true);
    const stale = results.find((r) => r.outcome === "stale");
    expect(stale && "item" in stale).toBe(false);
  });
});
