import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Checkbox } from "./checkbox";

describe("ui Checkbox", () => {
  test("renders a checkbox role with the checkbox data-slot", () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { checked: false }));

    expect(html).toContain('role="checkbox"');
    expect(html).toContain('data-slot="checkbox"');
  });

  test("reflects the checked state in aria-checked / data-state and shows a check", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { checked: true, "aria-label": "Select row" }),
    );

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain('aria-label="Select row"');
    // Both glyphs are mounted; CSS `data-state` gating decides which one shows.
    // The check glyph is revealed for the checked state, the minus stays hidden.
    expect(html).toContain("lucide-check");
    expect(html).toContain("group-data-[state=checked]:block");
    expect(html).toContain("group-data-[state=indeterminate]:block");
  });

  test("renders the tri-state indeterminate value (aria-checked=mixed, minus glyph)", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { checked: "indeterminate" }),
    );

    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain('data-state="indeterminate"');
    // Minus glyph is gated to the indeterminate state; the check glyph stays
    // hidden (never unconditionally rendered) so it cannot leak through.
    expect(html).toContain("lucide-minus");
    expect(html).toContain("group-data-[state=indeterminate]:block");
    expect(html).toContain("group-data-[state=checked]:block");
  });

  test("uncontrolled defaultChecked='indeterminate' shows the minus, not a stray check", () => {
    const html = renderToStaticMarkup(
      // No `checked` prop: `checked` is undefined, so an icon derived from the
      // raw prop would wrongly fall back to the check glyph. The glyph must be
      // driven by Radix's resolved `data-state` instead.
      createElement(Checkbox, { defaultChecked: "indeterminate" }),
    );

    expect(html).toContain('data-state="indeterminate"');
    // The check glyph must be gated (hidden + reveal only when checked), proving
    // it is not unconditionally rendered while the control is indeterminate.
    expect(html).toContain("group-data-[state=checked]:block");
    expect(html).toContain("group-data-[state=indeterminate]:block");
  });

  test("renders an unchecked control with no indicator glyph", () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { checked: false }));

    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('data-state="unchecked"');
    expect(html).not.toContain("lucide-check");
    expect(html).not.toContain("lucide-minus");
  });

  test("marks the trigger disabled when disabled is set", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { checked: false, disabled: true }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain('data-disabled');
  });

  test("merges a custom className with the token classes", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { checked: false, className: "custom-class" }),
    );

    expect(html).toContain("custom-class");
    expect(html).toContain("size-4");
    expect(html).toContain("rounded-[4px]");
  });
});
