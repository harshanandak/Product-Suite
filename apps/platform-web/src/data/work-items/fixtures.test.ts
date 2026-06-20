import { describe, expect, it } from "vitest";

import {
  createProjectFixtures,
  createTaskFixtures,
  createWorkItemFixtures,
} from "./fixtures";
import { deriveHealth } from "./types";

/** Reference clock the fixtures' due dates were designed around. */
const NOW = Date.parse("2026-06-20T00:00:00.000Z");

describe("work-item fixtures", () => {
  it("provides ~8-12 work items across 2-3 departments", () => {
    const items = createWorkItemFixtures();
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeLessThanOrEqual(12);

    const departments = new Set(items.map((item) => item.department));
    expect(departments.size).toBeGreaterThanOrEqual(2);
    expect(departments.size).toBeLessThanOrEqual(3);
  });

  it("includes 1-2 projects and some loose (null project_id) work items", () => {
    const projects = createProjectFixtures();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    expect(projects.length).toBeLessThanOrEqual(2);

    const items = createWorkItemFixtures();
    expect(items.some((item) => item.project_id === null)).toBe(true);
    expect(items.some((item) => item.project_id !== null)).toBe(true);
  });

  it("covers every phase and mixed task statuses", () => {
    const phases = new Set(createWorkItemFixtures().map((item) => item.phase));
    expect(phases).toEqual(new Set(["plan", "execute", "review", "done"]));

    const statuses = new Set(createTaskFixtures().map((task) => task.status));
    expect(statuses).toEqual(new Set(["todo", "in_progress", "completed"]));
  });

  it("produces varied derived health across all three values", () => {
    const items = createWorkItemFixtures();
    const tasks = createTaskFixtures();

    const healthValues = new Set(
      items.map((item) =>
        deriveHealth(
          item,
          tasks.filter((task) => task.work_item_id === item.id),
          NOW,
        ),
      ),
    );

    expect(healthValues).toEqual(new Set(["on_track", "at_risk", "blocked"]));
  });

  it("returns isolated copies so callers cannot mutate the source", () => {
    const first = createWorkItemFixtures();
    first[0].title = "mutated";
    const second = createWorkItemFixtures();
    expect(second[0].title).not.toBe("mutated");
  });
});
