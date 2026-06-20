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
    // checked -> check glyph, never the minus glyph
    expect(html).toContain("lucide-check");
    expect(html).not.toContain("lucide-minus");
  });

  test("renders the tri-state indeterminate value (aria-checked=mixed, minus glyph)", () => {
    const html = renderToStaticMarkup(
      createElement(Checkbox, { checked: "indeterminate" }),
    );

    expect(html).toContain('aria-checked="mixed"');
    expect(html).toContain('data-state="indeterminate"');
    // indeterminate -> minus glyph, never the check glyph
    expect(html).toContain("lucide-minus");
    expect(html).not.toContain("lucide-check");
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
