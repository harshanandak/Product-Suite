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
    expect(result.status).toBe("applied");
    if (result.status === "applied") {
      expect(result.item_id).toBeTruthy();
    }
    const after = await repo.list();
    expect(after.some((p) => p.id === first.id)).toBe(false);
  });

  it("accept on an unknown id reports a not_pending outcome", async () => {
    const result = await createMockProposalRepository().accept("nope");
    expect(result).toEqual({ status: "not_pending", proposal_id: "nope" });
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

  describe("undo", () => {
    /** The first fixture UPDATE — the only shape with a defined reversal. */
    async function acceptedUpdate() {
      const repository = createMockProposalRepository();
      const proposals = await repository.list();
      const update = proposals.find((p) => p.operation === "update");
      if (!update) throw new Error("fixtures carry no update proposal");
      await repository.accept(update.id);
      return { repository, update };
    }

    it("reverses an accepted update and links the item it restored", async () => {
      const { repository, update } = await acceptedUpdate();
      expect(await repository.undo(update.id)).toEqual({
        status: "undone",
        proposal_id: update.id,
        item_id: update.target_id,
      });
    });

    it("is single-step — the same accept cannot be undone twice", async () => {
      const { repository, update } = await acceptedUpdate();
      expect((await repository.undo(update.id)).status).toBe("undone");
      expect((await repository.undo(update.id)).status).not.toBe("undone");
    });

    it("refuses an accepted CREATE as not_undoable, WITH a reason", async () => {
      // An accepted create is KNOWN — it is simply outside undo's scope (its inverse
      // would be a delete). Reporting `not_found` would misdescribe it as unknown.
      const repository = createMockProposalRepository();
      const proposals = await repository.list();
      const create = proposals.find((p) => p.operation === "create");
      if (!create) throw new Error("fixtures carry no create proposal");
      await repository.accept(create.id);

      const result = await repository.undo(create.id);
      expect(result.status).toBe("not_undoable");
      if (result.status === "not_undoable") {
        expect(result.message).toMatch(/work item update/i);
      }
    });

    it("reserves not_found for a proposal that was never accepted", async () => {
      const repository = createMockProposalRepository();
      const [first] = await repository.list();
      expect((await repository.undo(first.id)).status).toBe("not_found");
    });

    it("reserves not_found for an id it has never seen", async () => {
      const repository = createMockProposalRepository();
      expect((await repository.undo("p_unknown")).status).toBe("not_found");
    });

    it("an already-undone update reports not_undoable, not not_found (it is known)", async () => {
      const { repository, update } = await acceptedUpdate();
      await repository.undo(update.id);
      const second = await repository.undo(update.id);
      expect(second.status).toBe("not_undoable");
      if (second.status === "not_undoable") {
        expect(second.message).toMatch(/already been undone/i);
      }
    });
  });
});
