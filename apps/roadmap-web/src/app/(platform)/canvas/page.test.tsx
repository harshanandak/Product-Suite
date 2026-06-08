import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CanvasPage from "./page";

describe("canvas platform page", () => {
  it("renders the reserved canvas module entry", () => {
    const html = renderToStaticMarkup(<CanvasPage />);

    expect(html).toContain("Canvas module");
    expect(html).toContain("visual collaboration");
  });
});
