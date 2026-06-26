import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PRIORITY_LABELS } from "./priority-badge";
import {
  PrioritySelect,
  PRIORITY_SELECT_OPTIONS,
  type PrioritySelectProps,
} from "./priority-select";

// SelectContent portals its items, which a headless renderer cannot mount (see
// phase-select.test.tsx). We assert the option SET (the single source of truth)
// and the onValueChange contract directly, and SSR-render the trigger for a11y.

const noop = () => {};

describe("PrioritySelect", () => {
  test("lists the four priorities, in severity order, with their labels", () => {
    expect(PRIORITY_SELECT_OPTIONS.map((o) => o.value)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
    expect(PRIORITY_SELECT_OPTIONS.map((o) => o.label)).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
    ]);
  });

  test("every option label matches the canonical PRIORITY_LABELS map", () => {
    expect(PRIORITY_SELECT_OPTIONS).toHaveLength(4);
    for (const { value, label } of PRIORITY_SELECT_OPTIONS) {
      expect(label).toBe(PRIORITY_LABELS[value]);
    }
  });

  test("forwards each Priority the underlying Select reports via onValueChange", () => {
    const onValueChange = mock<PrioritySelectProps["onValueChange"]>();
    // Read the handler the real component wires onto Radix's `Select` (source
    // line 67) instead of mounting the portal, then drive it with each option
    // value — exactly what Radix calls when the user picks an item.
    const tree = PrioritySelect({ value: "high", onValueChange }) as ReactElement<{
      onValueChange: (value: string) => void;
    }>;

    for (const { value } of PRIORITY_SELECT_OPTIONS) {
      tree.props.onValueChange(value);
    }

    expect(onValueChange).toHaveBeenCalledTimes(4);
    expect(onValueChange.mock.calls.map((c) => c[0])).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
  });

  test("renders an accessible trigger with the forwarded id and aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(PrioritySelect, {
        value: "high",
        onValueChange: noop,
        id: "priority-field",
        "aria-label": "Work item priority",
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="priority-field"');
    expect(html).toContain('aria-label="Work item priority"');
    expect(html).toContain('data-slot="priority-select-trigger"');
  });

  test("forwards the sm size to the trigger", () => {
    const html = renderToStaticMarkup(
      createElement(PrioritySelect, {
        value: "low",
        onValueChange: noop,
        size: "sm",
      }),
    );

    expect(html).toContain('data-size="sm"');
  });
});
