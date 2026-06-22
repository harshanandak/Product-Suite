import { describe, expect, it } from "vitest";

import { createMockWorkItemRepository } from "./repository";

describe("createMockWorkItemRepository", () => {
  it("lists work items, tasks, and projects", async () => {
    const repo = createMockWorkItemRepository();
    const [items, tasks, projects] = await Promise.all([
      repo.list(),
      repo.listTasks(),
      repo.listProjects(),
    ]);

    expect(items.length).toBeGreaterThan(0);
    expect(tasks.length).toBeGreaterThan(0);
    expect(projects.length).toBeGreaterThan(0);
  });

  it("lists owners whose ids cover the assigned items", async () => {
    const repo = createMockWorkItemRepository();
    const [owners, items] = await Promise.all([repo.listOwners(), repo.list()]);

    expect(owners.length).toBeGreaterThan(0);
    const ownerIds = new Set(owners.map((owner) => owner.id));
    const assignedIds = items
      .map((item) => item.assignee_id)
      .filter((id): id is string => id !== null);
    expect(assignedIds.every((id) => ownerIds.has(id))).toBe(true);
  });

  it("applies the richer editable fields through update", async () => {
    const repo = createMockWorkItemRepository();
    const [original] = await repo.list();

    const updated = await repo.update(original.id, {
      type: "research",
      priority: "critical",
      tags: ["alpha", "beta"],
    });
    expect(updated.type).toBe("research");
    expect(updated.priority).toBe("critical");
    expect(updated.tags).toEqual(["alpha", "beta"]);

    // Persisted across reads.
    const reloaded = (await repo.list()).find((item) => item.id === original.id);
    expect(reloaded?.priority).toBe("critical");
    expect(reloaded?.tags).toEqual(["alpha", "beta"]);
  });

  it("creates a fully-defaulted work item from an empty input", async () => {
    const repo = createMockWorkItemRepository();
    const before = await repo.list();

    const created = await repo.create({});
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Untitled work item");
    expect(created.phase).toBe("plan");
    expect(created.type).toBe("feature");
    expect(created.priority).toBe("medium");
    expect(created.tags).toEqual([]);
    expect(created.source).toBe("manual");
    expect(created.project_id).toBeNull();
    expect(created.assignee_id).toBeNull();
    expect(created.due_date).toBeNull();
    // New items start active (not soft-archived).
    expect(created.archived).toBe(false);
    // Department defaults to the first existing item's lane.
    expect(created.department).toBe(before[0]?.department);
    expect(Date.parse(created.created_at)).not.toBeNaN();

    // Persisted (and prepended) across reads.
    const after = await repo.list();
    expect(after.length).toBe(before.length + 1);
    expect(after[0].id).toBe(created.id);
  });

  it("honours provided fields when creating a work item", async () => {
    const repo = createMockWorkItemRepository();
    const created = await repo.create({
      title: "Spike caching",
      type: "research",
      priority: "high",
      department: "Platform",
      tags: ["spike"],
    });
    expect(created.title).toBe("Spike caching");
    expect(created.type).toBe("research");
    expect(created.priority).toBe("high");
    expect(created.department).toBe("Platform");
    expect(created.tags).toEqual(["spike"]);
  });

  it("generates a unique id per created work item", async () => {
    const repo = createMockWorkItemRepository();
    const a = await repo.create({});
    const b = await repo.create({});
    expect(a.id).not.toBe(b.id);
  });

  it("does not retain the caller's tags array reference after create", async () => {
    const repo = createMockWorkItemRepository();
    const callerTags = ["one"];
    const created = await repo.create({ tags: callerTags });
    callerTags.push("two");

    const reloaded = (await repo.list()).find((item) => item.id === created.id);
    expect(reloaded?.tags).toEqual(["one"]);
  });

  it("returns tasks scoped to a single work item via getTasks", async () => {
    const repo = createMockWorkItemRepository();
    const items = await repo.list();
    const target = items[0];

    const scoped = await repo.getTasks(target.id);
    expect(scoped.every((task) => task.work_item_id === target.id)).toBe(true);
  });

  it("updates a work item, applies the patch, and bumps updated_at", async () => {
    const repo = createMockWorkItemRepository();
    const [original] = await repo.list();

    const updated = await repo.update(original.id, { phase: "done" });
    expect(updated.id).toBe(original.id);
    expect(updated.phase).toBe("done");
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(original.updated_at),
    );

    // Persisted across reads.
    const reloaded = await repo.list();
    expect(reloaded.find((item) => item.id === original.id)?.phase).toBe("done");
  });

  it("toggles the archived flag through update and persists it", async () => {
    const repo = createMockWorkItemRepository();
    const [original] = await repo.list();

    const archived = await repo.update(original.id, { archived: true });
    expect(archived.archived).toBe(true);

    const reloaded = (await repo.list()).find((item) => item.id === original.id);
    expect(reloaded?.archived).toBe(true);

    // And back to active.
    const reactivated = await repo.update(original.id, { archived: false });
    expect(reactivated.archived).toBe(false);
  });

  it("rejects updating an unknown work item", async () => {
    const repo = createMockWorkItemRepository();
    await expect(repo.update("wi_does_not_exist", { phase: "plan" })).rejects.toThrow(
      /Unknown work item/,
    );
  });

  it("does not mutate the store when callers mutate returned records", async () => {
    const repo = createMockWorkItemRepository();
    const first = await repo.list();
    first[0].title = "tampered";

    const second = await repo.list();
    expect(second[0].title).not.toBe("tampered");
  });

  it("does not let a returned row's tags array poison the store", async () => {
    const repo = createMockWorkItemRepository();
    const first = await repo.list();
    first[0].tags.push("__tampered__");

    const second = await repo.list();
    expect(second[0].tags).not.toContain("__tampered__");
  });

  it("does not retain the caller's tags array reference after update", async () => {
    const repo = createMockWorkItemRepository();
    const [original] = await repo.list();
    const callerTags = ["one"];

    await repo.update(original.id, { tags: callerTags });
    callerTags.push("two"); // mutate AFTER the write

    const reloaded = (await repo.list()).find((item) => item.id === original.id);
    expect(reloaded?.tags).toEqual(["one"]);
  });

  it("keeps separate instances isolated", async () => {
    const repoA = createMockWorkItemRepository();
    const repoB = createMockWorkItemRepository();
    const [itemA] = await repoA.list();

    await repoA.update(itemA.id, { title: "only in A" });

    const inB = (await repoB.list()).find((item) => item.id === itemA.id);
    expect(inB?.title).not.toBe("only in A");
  });

  it("registers and unsubscribes invalidation callbacks", () => {
    const repo = createMockWorkItemRepository();
    let calls = 0;
    const unsubscribe = repo.subscribe(() => {
      calls += 1;
    });
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    // The mock never fires on its own; this only asserts the contract shape.
    expect(calls).toBe(0);
  });
});
