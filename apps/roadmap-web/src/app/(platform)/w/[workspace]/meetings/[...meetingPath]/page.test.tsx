import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WorkspaceMeetingPathPage, { dynamic } from "./page";

describe("workspace meeting path route", () => {
  it("preserves dynamic rendering for meeting deep links", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders new meeting deep links as create targets", async () => {
    const page = await WorkspaceMeetingPathPage({
      params: Promise.resolve({ workspace: "acme", meetingPath: ["new"] }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Create meeting");
    expect(html).toContain("New meeting draft");
    expect(html).toContain("acme meetings");
  });

  it("renders selected meeting deep links as selected targets", async () => {
    const page = await WorkspaceMeetingPathPage({
      params: Promise.resolve({
        workspace: "acme",
        meetingPath: ["meeting_123"],
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Selected meeting");
    expect(html).toContain("meeting 123");
  });

});
