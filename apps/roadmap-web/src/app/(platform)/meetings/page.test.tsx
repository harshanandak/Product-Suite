import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MeetingsPage from "./page";

describe("meetings platform page", () => {
  it("renders the shell-hosted meeting module entry", () => {
    const html = renderToStaticMarkup(<MeetingsPage />);

    expect(html).toContain("Meeting module");
    expect(html).toContain("Shared meeting block");
    expect(html).toContain("Product Suite planning review");
  });
});
