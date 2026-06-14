import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlatformModuleCard } from "../platform-module-card";

describe("platform module card", () => {
  it("renders a shared module heading and description", () => {
    const html = renderToStaticMarkup(
      <PlatformModuleCard
        title="Canvas module"
        description="Reserved shell entry for shared visual collaboration surfaces."
      />,
    );

    expect(html).toContain("Canvas module");
    expect(html).toContain("shared visual collaboration surfaces");
  });
});
