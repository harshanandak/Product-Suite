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

  it("honours the archived flag when creating a work item", async () => {
    const repo = createMockWorkItemRepository();
    const created = await repo.create({ archived: true });
    expect(created.archived).toBe(true);

    const reloaded = (await repo.list()).find((item) => item.id === created.id);
    expect(reloaded?.archived).toBe(true);
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

describe("createMockWorkItemRepository — dependencies", () => {
  it("lists the seeded dependency edges", async () => {
    const repo = createMockWorkItemRepository();
    const deps = await repo.listDependencies();
    expect(deps.length).toBeGreaterThan(0);
    expect(
      deps.some(
        (d) => d.source_item_id === "wi_auth" && d.target_item_id === "wi_realtime",
      ),
    ).toBe(true);
  });

  it("adds a new dependency with the default relationship and persists it", async () => {
    const repo = createMockWorkItemRepository();
    // wi_tabletoken and wi_adspend are orphans → a safe, cycle-free new edge.
    const created = await repo.addDependency({
      source_item_id: "wi_tabletoken",
      target_item_id: "wi_adspend",
    });
    expect(created.id).toBeTruthy();
    expect(created.relationship_type).toBe("depends_on");

    const deps = await repo.listDependencies();
    expect(
      deps.some(
        (d) =>
          d.source_item_id === "wi_tabletoken" &&
          d.target_item_id === "wi_adspend",
      ),
    ).toBe(true);
  });

  it("honours an explicit relationship_type", async () => {
    const repo = createMockWorkItemRepository();
    const created = await repo.addDependency({
      source_item_id: "wi_tabletoken",
      target_item_id: "wi_adspend",
      relationship_type: "blocks",
    });
    expect(created.relationship_type).toBe("blocks");
  });

  it("rejects an edge to or from an unknown work item", async () => {
    const repo = createMockWorkItemRepository();
    await expect(
      repo.addDependency({ source_item_id: "wi_ghost", target_item_id: "wi_auth" }),
    ).rejects.toThrow(/Unknown work item/);
    await expect(
      repo.addDependency({ source_item_id: "wi_auth", target_item_id: "wi_ghost" }),
    ).rejects.toThrow(/Unknown work item/);
  });

  it("rejects a self-dependency", async () => {
    const repo = createMockWorkItemRepository();
    await expect(
      repo.addDependency({ source_item_id: "wi_auth", target_item_id: "wi_auth" }),
    ).rejects.toThrow(/cannot depend on itself/);
  });

  it("rejects a duplicate edge", async () => {
    const repo = createMockWorkItemRepository();
    await expect(
      repo.addDependency({
        source_item_id: "wi_auth",
        target_item_id: "wi_realtime",
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects an edge that would close a cycle", async () => {
    const repo = createMockWorkItemRepository();
    // wi_auth → wi_realtime exists, so wi_realtime → wi_auth would loop.
    await expect(
      repo.addDependency({
        source_item_id: "wi_realtime",
        target_item_id: "wi_auth",
      }),
    ).rejects.toThrow(/cycle/);
  });

  it("removes a dependency by id and persists the removal", async () => {
    const repo = createMockWorkItemRepository();
    const [first] = await repo.listDependencies();
    await repo.removeDependency(first.id);
    const after = await repo.listDependencies();
    expect(after.some((d) => d.id === first.id)).toBe(false);
  });

  it("rejects removing an unknown dependency", async () => {
    const repo = createMockWorkItemRepository();
    await expect(repo.removeDependency("dep_ghost")).rejects.toThrow(
      /Unknown dependency/,
    );
  });

  it("listGraph without a focus returns every node and edge", async () => {
    const repo = createMockWorkItemRepository();
    const [graph, items, deps] = await Promise.all([
      repo.listGraph(),
      repo.list(),
      repo.listDependencies(),
    ]);
    expect(graph.nodes.length).toBe(items.length);
    expect(graph.dependencies.length).toBe(deps.length);
  });

  it("listGraph with a focus returns only the depth-bounded neighborhood", async () => {
    const repo = createMockWorkItemRepository();
    // wi_auth's 1-hop neighbors are wi_realtime + wi_migration.
    const graph = await repo.listGraph({ focusId: "wi_auth", depth: 1 });
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set(["wi_auth", "wi_realtime", "wi_migration"]));
    // Every returned edge has both endpoints in scope.
    expect(
      graph.dependencies.every(
        (d) => ids.has(d.source_item_id) && ids.has(d.target_item_id),
      ),
    ).toBe(true);
  });

  it("listGraph with an unknown focus returns an empty slice", async () => {
    const repo = createMockWorkItemRepository();
    const graph = await repo.listGraph({ focusId: "wi_ghost" });
    expect(graph.nodes).toEqual([]);
    expect(graph.dependencies).toEqual([]);
  });

  it("does not let a returned edge mutation poison the store", async () => {
    const repo = createMockWorkItemRepository();
    const first = await repo.listDependencies();
    first[0].relationship_type = "blocks";
    const second = await repo.listDependencies();
    expect(second[0].relationship_type).toBe("depends_on");
  });
});
