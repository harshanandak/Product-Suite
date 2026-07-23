import { describe, expect, test } from "vitest";

import type { ProjectWithCounts, WorkItemRow } from "../../data/work-items/types";

import {
  PROJECT_GROUP_ORDER,
  PROJECT_STATUS_VALUES,
  buildProjectGroups,
  formatTargetDate,
  rollUpProject,
} from "./project-rows";

function project(over: Partial<ProjectWithCounts> = {}): ProjectWithCounts {
  return {
    id: "p1",
    name: "Core product",
    kind: "general",
    status: "in_progress",
    lead_id: null,
    target_date: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    totalCount: 0,
    doneCount: 0,
    ...over,
  } as ProjectWithCounts;
}

function item(over: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "w1",
    project_id: "p1",
    phase: "execute",
    health: "on_track",
    checkCount: 0,
    completedCheckCount: 0,
    title: "An item",
    ...over,
  } as WorkItemRow;
}

describe("rollUpProject", () => {
  test("reads doneCount/totalCount off the project record — server-computed, never counted from items", () => {
    const rolled = rollUpProject(project({ totalCount: 3, doneCount: 1 }), [
      item({ id: "a", phase: "done" }),
      item({ id: "b", phase: "execute" }),
      item({ id: "c", phase: "plan" }),
    ]);

    expect(rolled.doneCount).toBe(1);
    expect(rolled.totalCount).toBe(3);
  });

  test("the project's counts stand even when the supplied item list disagrees with them", () => {
    // Proves the counts are NOT derived from `items` — an empty/mismatched item
    // list must not zero them out, since a real caller may not have loaded the
    // work-item set at all (that's the point of moving counts server-side).
    const rolled = rollUpProject(project({ totalCount: 5, doneCount: 2 }), []);
    expect(rolled.doneCount).toBe(2);
    expect(rolled.totalCount).toBe(5);
  });

  test("only items belonging to this project feed its `items` list and health", () => {
    const rolled = rollUpProject(project({ id: "p1" }), [
      item({ id: "a", project_id: "p1", health: "blocked" }),
      item({ id: "b", project_id: "p2", health: "blocked" }),
      item({ id: "c", project_id: null }),
    ]);

    expect(rolled.items.map((i) => i.id)).toEqual(["a"]);
    // The other project's / loose item's health must not leak into this rollup.
    expect(rolled.health).toBe("blocked");
  });

  test("health rolls up to the WORST member health, not an average", () => {
    // Reuses each item's already-derived health (never stored, never re-scored
    // here) and takes the worst by HEALTH_ORDER.
    expect(
      rollUpProject(project(), [
        item({ id: "a", health: "on_track" }),
        item({ id: "b", health: "at_risk" }),
        item({ id: "c", health: "on_track" }),
      ]).health,
    ).toBe("at_risk");

    expect(
      rollUpProject(project(), [
        item({ id: "a", health: "at_risk" }),
        item({ id: "b", health: "blocked" }),
      ]).health,
    ).toBe("blocked");
  });

  test("a project with no items has null health rather than a fake 'on track'", () => {
    const rolled = rollUpProject(project(), []);
    expect(rolled.health).toBeNull();
  });

  test("a project with no work items reports 0/0 rather than vanishing", () => {
    const rolled = rollUpProject(project({ totalCount: 0, doneCount: 0 }), []);
    expect(rolled.totalCount).toBe(0);
    expect(rolled.doneCount).toBe(0);
  });

  test("done items still count toward health rollup only via their own health", () => {
    const rolled = rollUpProject(project({ totalCount: 1, doneCount: 1 }), [
      item({ id: "a", phase: "done", health: "blocked" }),
    ]);
    expect(rolled.health).toBe("blocked");
    expect(rolled.doneCount).toBe(1);
  });
});

describe("buildProjectGroups", () => {
  test("groups projects by status in the declared display order", () => {
    const groups = buildProjectGroups(
      [
        project({ id: "a", name: "A", status: "backlog" }),
        project({ id: "b", name: "B", status: "in_progress" }),
        project({ id: "c", name: "C", status: "planned" }),
      ],
      [],
    );

    expect(groups.map((g) => g.status)).toEqual(["in_progress", "planned", "backlog"]);
  });

  test("omits statuses that have no projects", () => {
    const groups = buildProjectGroups([project({ status: "paused" })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.status).toBe("paused");
  });

  test("every status in the contract has a place in the display order", () => {
    // Compared against the CONTRACT's status list, not a literal copy of it: a
    // hardcoded array would stay just as unaware of a newly added ProjectStatus
    // as PROJECT_GROUP_ORDER does, so the assertion would keep passing while the
    // new status silently vanished from the board — the exact bug this guards.
    expect([...PROJECT_GROUP_ORDER].sort()).toEqual([...PROJECT_STATUS_VALUES].sort());
  });

  test("stays linear at scale — a board-sized set groups without re-scanning per project", () => {
    // 400 projects x 8000 items. Quadratic grouping (filtering every item once
    // per project) is 3.2M comparisons and blows the budget; single-pass
    // bucketing is ~8400. The assertion is correctness at scale; the timing
    // bound is what fails loudly if the linear path regresses. Counts are no
    // longer derived from `items` (they come from the project record), but the
    // items are still bucketed per project for health — so the perf shape this
    // guards is unchanged.
    const projects = Array.from({ length: 400 }, (_, i) =>
      project({ id: `p${i}`, name: `P${i}`, status: "in_progress", totalCount: 20, doneCount: 10 }),
    );
    const items = Array.from({ length: 8000 }, (_, i) =>
      item({
        id: `w${i}`,
        project_id: `p${i % 400}`,
        phase: Math.floor(i / 400) % 2 === 0 ? "done" : "execute",
      }),
    );

    const started = performance.now();
    const groups = buildProjectGroups(projects, items);
    const elapsedMs = performance.now() - started;

    expect(groups[0]?.rows).toHaveLength(400);
    expect(groups[0]?.rows[0]?.totalCount).toBe(20);
    expect(groups[0]?.rows[0]?.doneCount).toBe(10);
    expect(elapsedMs).toBeLessThan(250);
  });

  test("items with no project are dropped from a row's `items`, never shown under any project", () => {
    const groups = buildProjectGroups(
      [project({ id: "p1", status: "in_progress" })],
      [item({ project_id: null }), item({ id: "w2", project_id: "p1" })],
    );

    expect(groups[0]?.rows[0]?.items.map((i) => i.id)).toEqual(["w2"]);
  });

  test("carries each project's server-computed rollup into its row", () => {
    const groups = buildProjectGroups(
      [project({ id: "p1", status: "in_progress", totalCount: 2, doneCount: 1 })],
      [item({ project_id: "p1", phase: "done" }), item({ id: "w2", project_id: "p1" })],
    );

    expect(groups[0]?.rows[0]?.doneCount).toBe(1);
    expect(groups[0]?.rows[0]?.totalCount).toBe(2);
  });
});

describe("formatTargetDate", () => {
  test("renders one consistent format, never a mix of months and quarters", () => {
    expect(formatTargetDate("2026-12-31T00:00:00.000Z")).toBe("Dec 2026");
    expect(formatTargetDate("2027-01-15T00:00:00.000Z")).toBe("Jan 2027");
  });

  test("renders an em dash when there is no target", () => {
    expect(formatTargetDate(null)).toBe("—");
  });

  test("degrades to an em dash on an unparseable value rather than NaN", () => {
    expect(formatTargetDate("not-a-date")).toBe("—");
  });
});
