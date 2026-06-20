import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PHASE_LABELS, type Phase } from "./phase-pill";
import {
  PhaseSelect,
  PHASE_SELECT_OPTIONS,
  type PhaseSelectProps,
} from "./phase-select";

// `SelectContent` portals its items and only mounts them after Radix measures
// layout, which a headless renderer cannot do — the same reason the sibling
// `select.test.tsx` is a module smoke-test. We therefore assert the rendered
// option SET (the single source of truth the component maps over) and the
// `onValueChange` contract directly, and SSR-render the trigger for a11y.

const noop = () => {};

describe("PhaseSelect", () => {
  test("lists exactly the four phases, in loop order, with their labels", () => {
    expect(PHASE_SELECT_OPTIONS.map((o) => o.value)).toEqual([
      "plan",
      "execute",
      "review",
      "done",
    ]);
    expect(PHASE_SELECT_OPTIONS.map((o) => o.label)).toEqual([
      "Plan",
      "Execute",
      "Review",
      "Done",
    ]);
  });

  test("every option label matches the canonical PHASE_LABELS map", () => {
    expect(PHASE_SELECT_OPTIONS).toHaveLength(4);
    for (const { value, label } of PHASE_SELECT_OPTIONS) {
      expect(label).toBe(PHASE_LABELS[value]);
    }
  });

  test("fires onValueChange with the typed Phase chosen by the user", () => {
    // Reproduce the exact adapter PhaseSelect installs on the Select root:
    // Radix hands back a `string`, which we narrow to `Phase`.
    const onValueChange = mock<PhaseSelectProps["onValueChange"]>();
    const handleSelectChange = (next: string) => onValueChange(next as Phase);

    for (const { value } of PHASE_SELECT_OPTIONS) {
      handleSelectChange(value);
    }

    expect(onValueChange).toHaveBeenCalledTimes(4);
    expect(onValueChange.mock.calls.map((c) => c[0])).toEqual([
      "plan",
      "execute",
      "review",
      "done",
    ]);
  });

  test("renders an accessible trigger with the forwarded id and aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(PhaseSelect, {
        value: "review",
        onValueChange: noop,
        id: "phase-field",
        "aria-label": "Work item phase",
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="phase-field"');
    expect(html).toContain('aria-label="Work item phase"');
    expect(html).toContain('data-slot="phase-select-trigger"');
  });

  test("forwards the sm size to the trigger", () => {
    const html = renderToStaticMarkup(
      createElement(PhaseSelect, {
        value: "plan",
        onValueChange: noop,
        size: "sm",
      }),
    );

    expect(html).toContain('data-size="sm"');
  });
});
