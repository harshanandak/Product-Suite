import { describe, expect, it } from "vitest";

import { resolveLinkedObject, workItemIdFromPath } from "./linked-object";

describe("workItemIdFromPath", () => {
  it("extracts the id from the item-detail route", () => {
    expect(
      workItemIdFromPath("/w/befach-hq/workboard/item/wi_123", "befach-hq"),
    ).toBe("wi_123");
  });

  it("ignores a trailing segment after the id", () => {
    expect(
      workItemIdFromPath("/w/befach-hq/workboard/item/wi_123/tasks", "befach-hq"),
    ).toBe("wi_123");
  });

  it("returns null for a non-item route", () => {
    expect(workItemIdFromPath("/w/befach-hq/workboard", "befach-hq")).toBeNull();
  });
});

describe("resolveLinkedObject", () => {
  it("links a work_item on the item-detail route (id from the URL)", () => {
    const object = resolveLinkedObject(
      "/w/befach-hq/workboard/item/wi_123",
      "befach-hq",
    );
    expect(object.type).toBe("work_item");
    expect(object.id).toBe("wi_123");
    expect(typeof object.title).toBe("string");
  });

  it("links a screen (title from resolveScreen) on a board route", () => {
    const object = resolveLinkedObject("/w/befach-hq/workboard", "befach-hq");
    expect(object).toEqual({
      type: "screen",
      id: "/w/befach-hq/workboard",
      title: "Work items",
    });
  });
});
