import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TagInput,
  TagList,
  addTagValue,
  blurLeavesField,
  nextTagState,
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

describe("nextTagState", () => {
  test("accepts a new (trimmed) tag", () => {
    expect(nextTagState(["a"], "  b  ")).toEqual({
      tags: ["a", "b"],
      rejected: false,
    });
  });

  test("rejects a blank/whitespace tag (adds nothing)", () => {
    expect(nextTagState(["a"], "   ")).toEqual({ tags: ["a"], rejected: true });
    expect(nextTagState(["a"], "")).toEqual({ tags: ["a"], rejected: true });
  });

  test("rejects a duplicate tag (adds nothing)", () => {
    expect(nextTagState(["a", "b"], "a")).toEqual({
      tags: ["a", "b"],
      rejected: true,
    });
  });

  test("agrees with addTagValue on the resulting tag array", () => {
    for (const [tags, raw] of [
      [["a"], "b"],
      [["a"], "a"],
      [["a"], "  "],
    ] as const) {
      expect(nextTagState(tags, raw).tags).toEqual(addTagValue(tags, raw));
    }
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

describe("blurLeavesField", () => {
  const inside = {} as Node;
  const outside = {} as Node;
  const root = {
    contains: (node: Node | null) => node === inside,
  } as unknown as HTMLElement;

  test("does not commit when focus moves to a control inside the field", () => {
    // e.g. clicking a tag's remove button must not add the partial draft.
    expect(blurLeavesField(root, inside)).toBe(false);
  });

  test("commits when focus leaves the field entirely", () => {
    expect(blurLeavesField(root, outside)).toBe(true);
    expect(blurLeavesField(root, null)).toBe(true);
  });

  test("commits when there is no root node", () => {
    expect(blurLeavesField(null, inside)).toBe(true);
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

  test("wires a polite live region for blank/duplicate feedback, quiet at rest", () => {
    const html = renderToStaticMarkup(
      createElement(TagInput, {
        value: ["supplier"],
        onValueChange: noop,
        "aria-label": "Tags",
      }),
    );
    // An assertive-but-quiet status region exists so a rejected (blank/dup) add
    // can announce a lightweight cue without a layout-shifting visible banner.
    expect(html).toContain('data-slot="tag-input-feedback"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    // At rest (no rejected add) the field is valid: no aria-invalid asserted.
    expect(html).not.toContain('aria-invalid="true"');
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

  test("default variant keeps the bordered field", () => {
    const html = renderToStaticMarkup(
      createElement(TagInput, {
        value: ["supplier"],
        onValueChange: noop,
        "aria-label": "Tags",
      }),
    );
    expect(html).toContain('data-variant="default"');
    expect(html).toContain("border-input");
  });

  test("ghost variant is borderless and reveals each tag's ✕ on hover", () => {
    const html = renderToStaticMarkup(
      createElement(TagInput, {
        value: ["supplier"],
        onValueChange: noop,
        "aria-label": "Tags",
        variant: "ghost",
      }),
    );
    expect(html).toContain('data-variant="ghost"');
    // Flat chrome on the field: transparent border + subtle hover surface.
    expect(html).toContain("border-transparent");
    expect(html).toContain("hover:bg-accent/50");
    // The remove control is present but hidden until the chip is hovered/focused.
    expect(html).toContain('aria-label="Remove supplier"');
    expect(html).toContain("group-hover/tag:opacity-100");
  });
});
