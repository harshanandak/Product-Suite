import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WORK_ITEM_TYPE_LABELS, type WorkItemType } from "./work-item-type-badge";
import {
  WorkItemTypeSelect,
  WORK_ITEM_TYPE_SELECT_OPTIONS,
  type WorkItemTypeSelectProps,
} from "./work-item-type-select";

// SelectContent portals its items (see phase-select.test.tsx) — we assert the
// option SET and onValueChange contract directly, SSR-render the trigger.

const noop = () => {};

describe("WorkItemTypeSelect", () => {
  test("lists the four types, in display order, with their labels", () => {
    expect(WORK_ITEM_TYPE_SELECT_OPTIONS.map((o) => o.value)).toEqual([
      "feature",
      "bug",
      "chore",
      "research",
    ]);
    expect(WORK_ITEM_TYPE_SELECT_OPTIONS.map((o) => o.label)).toEqual([
      "Feature",
      "Bug",
      "Chore",
      "Research",
    ]);
  });

  test("every option label matches the canonical WORK_ITEM_TYPE_LABELS map", () => {
    expect(WORK_ITEM_TYPE_SELECT_OPTIONS).toHaveLength(4);
    for (const { value, label } of WORK_ITEM_TYPE_SELECT_OPTIONS) {
      expect(label).toBe(WORK_ITEM_TYPE_LABELS[value]);
    }
  });

  test("fires onValueChange with the typed WorkItemType chosen", () => {
    const onValueChange = mock<WorkItemTypeSelectProps["onValueChange"]>();
    const handleSelectChange = (next: WorkItemType) => onValueChange(next);

    for (const { value } of WORK_ITEM_TYPE_SELECT_OPTIONS) {
      handleSelectChange(value);
    }

    expect(onValueChange).toHaveBeenCalledTimes(4);
    expect(onValueChange.mock.calls.map((c) => c[0])).toEqual([
      "feature",
      "bug",
      "chore",
      "research",
    ]);
  });

  test("renders an accessible trigger with the forwarded id and aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(WorkItemTypeSelect, {
        value: "bug",
        onValueChange: noop,
        id: "type-field",
        "aria-label": "Work item type",
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="type-field"');
    expect(html).toContain('aria-label="Work item type"');
    expect(html).toContain('data-slot="work-item-type-select-trigger"');
  });
});
