import { describe, expect, it } from "vitest";

import { createProposalFixtures } from "./fixtures";

describe("proposal fixtures", () => {
  it("returns pending proposals with operation-consistent targets", () => {
    const proposals = createProposalFixtures();
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(p.status).toBe("pending");
      expect(p.target_type).toBe("work_item");
      // A create has no target; an update must point at an existing item so the
      // detail view can render a real current → proposed diff.
      if (p.operation === "create") expect(p.target_id).toBeNull();
      else expect(typeof p.target_id).toBe("string");
    }
  });

  it("exercises both operations so the inbox renders create + update views", () => {
    const ops = new Set(createProposalFixtures().map((p) => p.operation));
    expect(ops.has("create")).toBe(true);
    expect(ops.has("update")).toBe(true);
  });

  it("deep-clones per call so the mock repository can mutate without poisoning source", () => {
    const first = createProposalFixtures();
    const second = createProposalFixtures();
    // Distinct array + element + nested payload identities.
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0].payload).not.toBe(second[0].payload);

    // Mutating one batch (as accept/reject splice does) leaves a fresh batch intact.
    (first[0].payload as Record<string, unknown>).title = "MUTATED";
    first.pop();
    const pristine = createProposalFixtures();
    expect(pristine.length).toBe(second.length);
    expect(pristine[0].payload.title).not.toBe("MUTATED");
  });
});
