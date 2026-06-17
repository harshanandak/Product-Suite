import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Skeleton } from "./skeleton";

describe("ui Skeleton", () => {
  test("renders a pulsing placeholder with the skeleton data-slot", () => {
    const html = renderToStaticMarkup(
      createElement(Skeleton, { className: "h-4 w-24" }),
    );

    expect(html).toContain('data-slot="skeleton"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("h-4");
    expect(html).toContain("w-24");
  });
});
