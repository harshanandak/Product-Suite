import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WorkspaceHomePage from "./page";

describe("workspace home route", () => {
  it("renders the workspace home placeholder", () => {
    const html = renderToStaticMarkup(<WorkspaceHomePage />);

    expect(html).toContain("Home");
    expect(html).toContain("Workspace digest");
  });
});
