import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PlatformError from "./error";

describe("platform error route", () => {
  it("renders a module-scoped failure state", () => {
    const html = renderToStaticMarkup(
      <PlatformError error={new Error("route failed")} reset={vi.fn()} />,
    );

    expect(html).toContain("Product Suite module could not load");
    expect(html).toContain("route failed");
    expect(html).toContain("Try again");
  });
});
