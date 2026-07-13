import { describe, expect, it } from "vitest";

import { createMockProposalRepository } from "./repository";

describe("createMockProposalRepository", () => {
  it("lists a create and an update fixture proposal", async () => {
    const proposals = await createMockProposalRepository().list();
    expect(proposals.map((p) => p.operation).sort()).toEqual([
      "create",
      "update",
    ]);
    const update = proposals.find((p) => p.operation === "update");
    expect(update?.target_id).not.toBeNull();
    const create = proposals.find((p) => p.operation === "create");
    expect(create?.target_id).toBeNull();
  });

  it("accept applies and removes the proposal, returning the item", async () => {
    const repo = createMockProposalRepository();
    const [first] = await repo.list();
    const result = await repo.accept(first.id);
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.item.id).toBeTruthy();
    }
    const after = await repo.list();
    expect(after.some((p) => p.id === first.id)).toBe(false);
  });

  it("accept on an unknown id reports a stale outcome", async () => {
    const result = await createMockProposalRepository().accept("nope");
    expect(result).toEqual({ outcome: "stale" });
  });

  it("reject removes the proposal from the pending list", async () => {
    const repo = createMockProposalRepository();
    const [first] = await repo.list();
    await repo.reject(first.id, "not needed");
    const after = await repo.list();
    expect(after.some((p) => p.id === first.id)).toBe(false);
  });

  it("each instance owns an isolated copy of the fixtures", async () => {
    const a = createMockProposalRepository();
    const [first] = await a.list();
    await a.accept(first.id);
    const b = await createMockProposalRepository().list();
    // A fresh instance is unaffected by the first's accept.
    expect(b.some((p) => p.id === first.id)).toBe(true);
  });
});
