import { describe, expect, expectTypeOf, it } from "vitest";

import {
  deriveHealth,
  type Task,
  type WorkItem,
  type WorkItemPatch,
} from "./types";

/** Fixed reference clock for deterministic health derivation. */
const NOW = Date.parse("2026-06-20T00:00:00.000Z");

const PAST = "2026-06-10T00:00:00.000Z";
const FUTURE = "2026-07-10T00:00:00.000Z";

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_test",
    title: "Test item",
    phase: "execute",
    type: "feature",
    priority: "medium",
    tags: [],
    source: "manual",
    project_id: null,
    department: "Engineering",
    assignee_id: null,
    due_date: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t_test",
    work_item_id: "wi_test",
    title: "Test task",
    status: "todo",
    due_date: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkItem schema", () => {
  it("carries the richer descriptive fields with the right value sets", () => {
    const item = workItem({
      type: "bug",
      priority: "critical",
      tags: ["infra", "urgent"],
      source: "agent",
    });
    expect(item.type).toBe("bug");
    expect(item.priority).toBe("critical");
    expect(item.tags).toEqual(["infra", "urgent"]);
    expect(item.source).toBe("agent");
  });

  it("treats tags as a present-but-possibly-empty array (never null)", () => {
    expect(workItem().tags).toEqual([]);
    expectTypeOf<WorkItem["tags"]>().toEqualTypeOf<string[]>();
  });

  it("makes type/priority/tags editable in WorkItemPatch but NOT source", () => {
    // Editable fields compile inside a patch.
    const patch: WorkItemPatch = {
      type: "chore",
      priority: "low",
      tags: ["x"],
      phase: "review",
    };
    expect(patch.type).toBe("chore");
    // `source` is display-only (provenance recorded once) — it is not a key of
    // WorkItemPatch, so it must never be assignable.
    expectTypeOf<WorkItemPatch>().not.toHaveProperty("source");
  });

  it("treats archived as an optional boolean flag the patch can toggle", () => {
    // Absent ⇒ active; the flag is optional on the work item.
    expectTypeOf<WorkItem["archived"]>().toEqualTypeOf<boolean | undefined>();
    expect(workItem().archived).toBeUndefined();
    expect(workItem({ archived: true }).archived).toBe(true);

    // The row menu toggles archived via WorkItemPatch.
    const patch: WorkItemPatch = { archived: true };
    expect(patch.archived).toBe(true);
  });
});

describe("deriveHealth", () => {
  it("returns on_track when nothing is overdue", () => {
    const result = deriveHealth(
      workItem({ due_date: FUTURE }),
      [task({ status: "in_progress", due_date: FUTURE })],
      NOW,
    );
    expect(result).toBe("on_track");
  });

  it("returns on_track for an empty task list and no due date", () => {
    expect(deriveHealth(workItem(), [], NOW)).toBe("on_track");
  });

  it("returns blocked when the item is overdue and a task is still open", () => {
    const result = deriveHealth(
      workItem({ due_date: PAST }),
      [task({ status: "todo", due_date: null })],
      NOW,
    );
    expect(result).toBe("blocked");
  });

  it("returns at_risk when a task is overdue but the item is not", () => {
    const result = deriveHealth(
      workItem({ due_date: FUTURE }),
      [task({ status: "in_progress", due_date: PAST })],
      NOW,
    );
    expect(result).toBe("at_risk");
  });

  it("returns at_risk when the item is overdue and has no tasks", () => {
    expect(deriveHealth(workItem({ due_date: PAST }), [], NOW)).toBe("at_risk");
  });

  it("treats an overdue but completed task as not raising health", () => {
    const result = deriveHealth(
      workItem({ due_date: FUTURE }),
      [task({ status: "completed", due_date: PAST })],
      NOW,
    );
    expect(result).toBe("on_track");
  });

  it("returns on_track for a done item even when its due date passed", () => {
    const result = deriveHealth(
      workItem({ phase: "done", due_date: PAST }),
      [task({ status: "completed", due_date: null })],
      NOW,
    );
    expect(result).toBe("on_track");
  });

  it("prioritizes blocked over at_risk", () => {
    // Item overdue (→ blocked candidate) AND an overdue open task (→ at_risk candidate).
    const result = deriveHealth(
      workItem({ due_date: PAST }),
      [task({ status: "todo", due_date: PAST })],
      NOW,
    );
    expect(result).toBe("blocked");
  });

  it("is deterministic via the injected now (no implicit clock read)", () => {
    const item = workItem({ due_date: "2026-06-15T00:00:00.000Z" });
    const tasks = [task({ status: "todo", due_date: null })];
    // Before due date → on_track; after → blocked.
    expect(deriveHealth(item, tasks, Date.parse("2026-06-01T00:00:00.000Z"))).toBe(
      "on_track",
    );
    expect(deriveHealth(item, tasks, Date.parse("2026-06-20T00:00:00.000Z"))).toBe(
      "blocked",
    );
  });
});
