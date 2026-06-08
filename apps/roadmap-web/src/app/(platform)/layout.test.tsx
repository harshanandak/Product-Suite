import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
}));

import PlatformLayout from "./layout";

describe("platform route group layout", () => {
  it("wraps module content in the platform shell", () => {
    const html = renderToStaticMarkup(
      <PlatformLayout>
        <section>Settings module content</section>
      </PlatformLayout>,
    );

    expect(html).toContain("Product Suite");
    expect(html).toContain("Settings");
    expect(html).toContain("Settings module content");
    expect(html).toContain('aria-current="page"');
  });
});
