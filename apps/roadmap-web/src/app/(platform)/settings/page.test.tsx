import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SettingsPage from "./page";

describe("settings platform page", () => {
  it("renders the reserved settings module entry", () => {
    const html = renderToStaticMarkup(<SettingsPage />);

    expect(html).toContain("Settings module");
    expect(html).toContain("administration");
  });
});
