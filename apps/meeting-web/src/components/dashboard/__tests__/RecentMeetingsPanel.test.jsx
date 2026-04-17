// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";

import { RecentMeetingsPanel } from "../RecentMeetingsPanel";

function renderPanel(props = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RecentMeetingsPanel {...props} />
    </MemoryRouter>
  );
}

describe("RecentMeetingsPanel", () => {
  test("renders the loading state while meetings are still bootstrapping", () => {
    const html = renderPanel({ bootstrapStatus: "loading" });

    expect(html).toContain("Loading recent meetings...");
    expect(html).not.toContain("No meetings yet.");
  });

  test("renders the empty state actions when there are no meetings", () => {
    const html = renderPanel({ bootstrapStatus: "ready", meetings: [] });

    expect(html).toContain("No meetings yet.");
    expect(html).toContain("Open workspace");
    expect(html).toContain("Review meeting history");
  });

  test("renders recent meetings when history is available", () => {
    const html = renderPanel({
      bootstrapStatus: "ready",
      meetings: [
        {
          id: "meeting-1",
          title: "Launch readiness sync",
          status: "completed",
          duration_seconds: 1800,
        },
      ],
    });

    expect(html).toContain("Launch readiness sync");
    expect(html).toContain("/meetings/meeting-1");
    expect(html).toContain("1800s captured");
  });
});
