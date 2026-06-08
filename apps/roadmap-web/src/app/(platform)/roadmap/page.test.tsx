import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RoadmapPage from "./page";

describe("roadmap platform page", () => {
  it("renders the roadmap module entry", () => {
    const html = renderToStaticMarkup(<RoadmapPage />);

    expect(html).toContain("Roadmap module");
    expect(html).toContain("workspace URLs remain available");
  });
});
