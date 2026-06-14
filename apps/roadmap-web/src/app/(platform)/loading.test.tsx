import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PlatformLoading from "./loading";

describe("platform loading route", () => {
  it("renders a module-scoped loading state", () => {
    const html = renderToStaticMarkup(<PlatformLoading />);

    expect(html).toContain("Loading Product Suite module");
  });
});
