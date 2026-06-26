import { describe, expect, it } from "vitest";

import {
  createOwnerFixtures,
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

  it("populates varied type / priority / source across items", () => {
    const items = createWorkItemFixtures();

    const types = new Set(items.map((item) => item.type));
    const priorities = new Set(items.map((item) => item.priority));
    const sources = new Set(items.map((item) => item.source));

    // Several distinct values of each so columns/filters have real spread.
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(priorities.size).toBeGreaterThanOrEqual(3);
    expect(sources.size).toBeGreaterThanOrEqual(3);

    // Every value is a valid member of its enum.
    expect(
      items.every((item) =>
        ["feature", "bug", "chore", "research"].includes(item.type),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        ["critical", "high", "medium", "low"].includes(item.priority),
      ),
    ).toBe(true);
    expect(
      items.every((item) =>
        ["manual", "meeting", "agent", "feedback"].includes(item.source),
      ),
    ).toBe(true);
  });

  it("marks exactly the Sample QC checklist archived, leaving the rest active", () => {
    const items = createWorkItemFixtures();

    const archived = items.filter((item) => item.archived === true);
    expect(archived.map((item) => item.id)).toEqual(["wi_samples"]);

    // Every other item is active (archived is falsy — false here).
    expect(
      items
        .filter((item) => item.id !== "wi_samples")
        .every((item) => !item.archived),
    ).toBe(true);
  });

  it("gives every item a tags array (some non-empty, never null)", () => {
    const items = createWorkItemFixtures();
    expect(items.every((item) => Array.isArray(item.tags))).toBe(true);
    expect(items.some((item) => item.tags.length > 0)).toBe(true);
  });

  it("includes a couple of unassigned (department-queue) items", () => {
    const items = createWorkItemFixtures();
    const unassigned = items.filter((item) => item.assignee_id === null);
    expect(unassigned.length).toBeGreaterThanOrEqual(2);
  });

  it("provides owners whose ids resolve every assigned item", () => {
    const owners = createOwnerFixtures();
    expect(owners.length).toBeGreaterThan(0);

    const ownerIds = new Set(owners.map((owner) => owner.id));
    const assignedIds = createWorkItemFixtures()
      .map((item) => item.assignee_id)
      .filter((id): id is string => id !== null);

    // Every non-null assignee_id has a matching owner (lookup never misses).
    expect(assignedIds.every((id) => ownerIds.has(id))).toBe(true);
  });

  it("returns isolated owner copies so callers cannot mutate the source", () => {
    const first = createOwnerFixtures();
    first[0].name = "mutated";
    const second = createOwnerFixtures();
    expect(second[0].name).not.toBe("mutated");
  });

  it("returns isolated copies so callers cannot mutate the source", () => {
    const first = createWorkItemFixtures();
    first[0].title = "mutated";
    const second = createWorkItemFixtures();
    expect(second[0].title).not.toBe("mutated");
  });

  it("isolates the tags array per call (push must not poison the source)", () => {
    const first = createWorkItemFixtures();
    first[0].tags.push("__poison__");
    const second = createWorkItemFixtures();
    expect(second[0].tags).not.toContain("__poison__");
  });
});
