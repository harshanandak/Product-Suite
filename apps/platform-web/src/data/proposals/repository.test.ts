import { describe, expect, it } from "vitest";

import { createMockProposalRepository } from "./repository";

describe("createMockProposalRepository", () => {
  it("lists a create proposal plus update proposals against real targets", async () => {
    const proposals = await createMockProposalRepository().list();
    const operations = proposals.map((p) => p.operation);
    expect(operations).toContain("create");
    expect(operations).toContain("update");

    // Every update targets an existing item; the create targets nothing.
    const updates = proposals.filter((p) => p.operation === "update");
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.every((p) => p.target_id !== null)).toBe(true);
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

  it("activeRules resolves an empty array (the mock carries no run→rule attributions)", async () => {
    const rules = await createMockProposalRepository().activeRules("p1");
    expect(rules).toEqual([]);
  });

  it("activeRules honors the configured latency before resolving", async () => {
    const repo = createMockProposalRepository({ latencyMs: 20 });
    const start = Date.now();
    await repo.activeRules("p1");
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
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
