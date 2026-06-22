import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WorkItemTypeBadge,
  WORK_ITEM_TYPE_LABELS,
  WORK_ITEM_TYPE_ORDER,
} from "./work-item-type-badge";

describe("WorkItemType enum + labels", () => {
  test("WORK_ITEM_TYPE_ORDER is the four canonical types (no `task`)", () => {
    expect(WORK_ITEM_TYPE_ORDER).toEqual([
      "feature",
      "bug",
      "chore",
      "research",
    ]);
    // `task` is a distinct object in the ladder (§1/§11), never a type.
    expect(WORK_ITEM_TYPE_ORDER).not.toContain("task");
  });

  test("WORK_ITEM_TYPE_LABELS has a human label for every type", () => {
    expect(WORK_ITEM_TYPE_LABELS).toEqual({
      feature: "Feature",
      bug: "Bug",
      chore: "Chore",
      research: "Research",
    });
  });
});

describe("WorkItemTypeBadge", () => {
  test("renders label, icon, and a data-type hook for each type", () => {
    for (const type of WORK_ITEM_TYPE_ORDER) {
      const html = renderToStaticMarkup(
        createElement(WorkItemTypeBadge, { type }),
      );
      expect(html).toContain(`data-type="${type}"`);
      expect(html).toContain(WORK_ITEM_TYPE_LABELS[type]);
      expect(html).toContain("<svg");
    }
  });

  test("merges a custom className and forwards span attributes", () => {
    const html = renderToStaticMarkup(
      createElement(WorkItemTypeBadge, {
        type: "feature",
        className: "ml-2",
        title: "Type",
      }),
    );
    expect(html).toContain("ml-2");
    expect(html).toContain('title="Type"');
  });
});
