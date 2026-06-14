import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModuleSwitcher } from "../module-switcher";

describe("module switcher", () => {
  it("marks the active module and reserved modules from the registry", () => {
    const html = renderToStaticMarkup(<ModuleSwitcher activePath="/w/acme/canvas/doc_123" />);

    expect(html).not.toContain('href="/canvas"');
    expect(html).toContain('href="/w/acme/meetings"');
    expect(html).toContain('href="/w/acme/workboard"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Canvas");
    expect(html).toContain("Coming soon");
    expect(html).toContain('aria-disabled="true"');
  });
});
