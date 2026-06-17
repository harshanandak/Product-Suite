import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Separator } from "./separator";

describe("ui Separator", () => {
  test("renders a decorative separator carrying the separator data-slot", () => {
    const html = renderToStaticMarkup(createElement(Separator, null));

    // Match both "separator" and the "separator-root" slot naming shadcn uses.
    expect(html).toContain('data-slot="separator');
    expect(html).toContain("<div");
  });
});
