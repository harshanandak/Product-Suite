import { describe, expect, it } from "vitest";

import { createMemoryFixtures, createMockMemoriesAdapter } from "./mock";

describe("createMockMemoriesAdapter", () => {
  it("lists the seeded fixtures newest-first", async () => {
    const adapter = createMockMemoriesAdapter();
    const rows = await adapter.list();
    expect(rows.length).toBe(createMemoryFixtures().length);
    // Newest-first by created_at.
    expect(rows[0]!.created_at >= rows[1]!.created_at).toBe(true);
  });

  it("filters by kind, status, and topic", async () => {
    const adapter = createMockMemoriesAdapter();
    expect((await adapter.list({ kind: "fact" })).every((m) => m.kind === "fact")).toBe(
      true,
    );
    expect(
      (await adapter.list({ topic: "models" })).every((m) =>
        m.topics.includes("models"),
      ),
    ).toBe(true);
    expect(
      (await adapter.list({ status: "active" })).every((m) => m.status === "active"),
    ).toBe(true);
  });

  it("create() appends an immediately-active memory", async () => {
    const adapter = createMockMemoriesAdapter();
    const created = await adapter.create({
      kind: "decision",
      title: "Fresh call",
      topics: ["x"],
    });
    expect(created.status).toBe("active");
    expect(created.title).toBe("Fresh call");
    const listed = await adapter.list();
    expect(listed.some((m) => m.id === created.id)).toBe(true);
  });

  it("supersede() marks the old row superseded and links a new active version", async () => {
    const adapter = createMockMemoriesAdapter();
    const replacement = await adapter.supersede("mem_1", {
      change_reason: "cheaper option found",
      title: "Switch writer model",
    });
    expect(replacement.status).toBe("active");
    expect(replacement.supersedes_id).toBe("mem_1");
    expect(replacement.change_reason).toBe("cheaper option found");

    const detail = await adapter.get("mem_1");
    expect(detail.memory.status).toBe("superseded");
    expect(detail.memory.superseded_by_id).toBe(replacement.id);
    // The chain shares one root and is ordered oldest-first.
    expect(detail.chain.map((m) => m.id)).toContain(replacement.id);
    expect(detail.chain[0]!.id).toBe("mem_1");
  });

  it("retract() and defer() move a memory to its terminal status", async () => {
    const adapter = createMockMemoriesAdapter();
    expect((await adapter.retract("mem_2")).status).toBe("retracted");
    const deferred = await adapter.defer("mem_3", { waiting_on: "budget" });
    expect(deferred.status).toBe("deferred");
    expect(deferred.waiting_on).toBe("budget");
  });

  it("get() throws a 404-style error for an unknown id", async () => {
    const adapter = createMockMemoriesAdapter();
    await expect(adapter.get("nope")).rejects.toThrow("404");
  });
});
