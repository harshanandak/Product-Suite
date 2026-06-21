import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TagInput,
  TagList,
  addTagValue,
  removeTagValue,
} from "./tag-input";

// This package's tests are SSR-only (no DOM env — see phase-select.test.tsx).
// The keyboard behaviour lives in pure reducers we unit-test directly, and the
// rendered structure / a11y is asserted via SSR markup.

const noop = () => {};

describe("addTagValue", () => {
  test("appends a trimmed tag", () => {
    expect(addTagValue(["a"], "  b  ")).toEqual(["a", "b"]);
  });

  test("ignores blank input", () => {
    expect(addTagValue(["a"], "   ")).toEqual(["a"]);
  });

  test("ignores a duplicate (case-sensitive)", () => {
    expect(addTagValue(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(addTagValue(["a"], "A")).toEqual(["a", "A"]);
  });
});

describe("removeTagValue", () => {
  test("drops the named tag", () => {
    expect(removeTagValue(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  test("is a no-op for an absent tag", () => {
    expect(removeTagValue(["a"], "x")).toEqual(["a"]);
  });
});

describe("TagList", () => {
  test("renders every tag when no max is set", () => {
    const html = renderToStaticMarkup(
      createElement(TagList, { tags: ["supplier", "q3", "urgent"] }),
    );
    expect(html).toContain("supplier");
    expect(html).toContain("q3");
    expect(html).toContain("urgent");
    expect(html).toContain('data-slot="tag-list"');
  });

  test("collapses overflow into a +N chip past max", () => {
    const html = renderToStaticMarkup(
      createElement(TagList, { tags: ["a", "b", "c", "d"], max: 2 }),
    );
    expect(html).toContain("a");
    expect(html).toContain("b");
    expect(html).toContain("+2");
    expect(html).toContain('data-slot="tag-overflow"');
    // Hidden tags listed in the title for hover/non-visual discovery.
    expect(html).toContain('title="c, d"');
  });
});

describe("TagInput", () => {
  test("renders a removable button with an accessible name per tag", () => {
    const html = renderToStaticMarkup(
      createElement(TagInput, {
        value: ["supplier", "q3"],
        onValueChange: noop,
        "aria-label": "Tags",
      }),
    );
    expect(html).toContain('data-slot="tag-input"');
    // Real <button> remove controls, not clickable spans.
    expect(html).toContain('aria-label="Remove supplier"');
    expect(html).toContain('aria-label="Remove q3"');
    expect(html).toContain("<button");
    // The draft text input carries the field's accessible name.
    expect(html).toContain('aria-label="Tags"');
  });

  test("disables the remove buttons and input when disabled", () => {
    const html = renderToStaticMarkup(
      createElement(TagInput, {
        value: ["supplier"],
        onValueChange: noop,
        "aria-label": "Tags",
        disabled: true,
      }),
    );
    expect(html).toContain("disabled");
  });
});
