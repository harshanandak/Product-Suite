import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AgentsPage from "./page";

describe("agents platform page", () => {
  it("renders the reserved agents module entry", () => {
    const html = renderToStaticMarkup(<AgentsPage />);

    expect(html).toContain("Agents module");
    expect(html).toContain("automation agents");
  });
});
