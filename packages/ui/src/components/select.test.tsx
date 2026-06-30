import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Select is a Radix UI portal/context primitive that requires a browser
// environment to render, so we smoke-test the module here and exercise its
// behaviour in the app shell integration tests.
import * as Select from "./select";

describe("ui Select module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Select);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});

// The closed trigger renders to static markup without a browser, so we can lock
// the additive `invalid` a11y prop (Rank 20 Wave B item 3) here. Note the
// trigger's className contains the Tailwind variant string "aria-invalid:" at
// all times — assertions therefore match the ATTRIBUTE form `aria-invalid="true"`
// so they distinguish the styling hook from the actual ARIA state.
function triggerMarkup(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(
      Select.Select,
      { defaultValue: "x" },
      createElement(
        Select.SelectTrigger,
        { "aria-label": "Pick one", ...props },
        createElement(Select.SelectValue, {}),
      ),
    ),
  );
}

describe("SelectTrigger invalid state", () => {
  test("default trigger asserts no aria-invalid (valid-state unchanged)", () => {
    const html = triggerMarkup({});
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  test("invalid={false} stays valid: no aria-invalid asserted", () => {
    expect(triggerMarkup({ invalid: false })).not.toContain(
      'aria-invalid="true"',
    );
  });

  test("invalid sets aria-invalid on the trigger", () => {
    expect(triggerMarkup({ invalid: true })).toContain('aria-invalid="true"');
  });

  test("`invalid` is internal: it is not leaked onto the DOM element", () => {
    // Leading space distinguishes a leaked bare `invalid=` attribute from the
    // legitimate `aria-invalid=` (whose preceding char is "-", not a space).
    expect(triggerMarkup({ invalid: true })).not.toContain(" invalid=");
  });

  test("a directly-passed aria-invalid is still honored (passthrough intact)", () => {
    expect(triggerMarkup({ "aria-invalid": true })).toContain(
      'aria-invalid="true"',
    );
  });
});
