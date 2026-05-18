import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceMeetingSurface } from "../workspace-meeting-surface";

describe("roadmap workspace meeting surface", () => {
  it("renders the shared meeting block from the ui-meeting package", () => {
    const html = renderToStaticMarkup(
      <WorkspaceMeetingSurface
        workspaceName="Launch Workspace"
        recentMeetingTitle="Planning Review"
      />,
    );

    expect(html).toContain("Launch Workspace");
    expect(html).toContain("Planning Review");
    expect(html).toContain("Shared meeting block");
    expect(html).toContain("Decisions");
  });
});
