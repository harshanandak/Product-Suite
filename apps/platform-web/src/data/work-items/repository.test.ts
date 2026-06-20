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
