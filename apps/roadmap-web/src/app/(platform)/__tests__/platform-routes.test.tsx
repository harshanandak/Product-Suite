import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockedPathname = "/meetings";

vi.mock("next/navigation", () => ({
  usePathname: () => mockedPathname,
}));

import AgentsPage from "../agents/page";
import CanvasPage from "../canvas/page";
import PlatformLayout from "../layout";
import MeetingsPage from "../meetings/page";
import RoadmapPage from "../roadmap/page";
import SettingsPage from "../settings/page";
import WorkspaceAgentsPage from "../w/[workspace]/agents/page";
import WorkspaceCanvasPage from "../w/[workspace]/canvas/page";
import WorkspaceHomePage from "../w/[workspace]/page";
import WorkspaceMeetingsPage from "../w/[workspace]/meetings/page";
import WorkspaceMeetingPathPage from "../w/[workspace]/meetings/[...meetingPath]/page";
import WorkspaceSettingsPage from "../w/[workspace]/settings/page";
import WorkspaceWorkboardPage from "../w/[workspace]/workboard/page";

const currentDir = dirname(fileURLToPath(import.meta.url));
const meetingsPageSource = readFileSync(
  resolve(currentDir, "../meetings/page.tsx"),
  "utf8",
);

describe("platform module routes", () => {
  beforeEach(() => {
    mockedPathname = "/meetings";
  });

  it("renders the Meetings route inside the platform shell without importing meeting-web runtime", () => {
    mockedPathname = "/meetings";

    const html = renderRoute(<MeetingsPage />);

    expect(html).toContain("Product Suite");
    expect(html).toContain("Meetings");
    expect(html).toContain("Meeting module");
    expect(html).toContain("Shared meeting block");
    expect(html).toContain('aria-current="page"');
    expect(meetingsPageSource).not.toContain("apps/meeting-web");
    expect(meetingsPageSource).not.toContain("App.jsx");
  });

  it.each([
    ["/roadmap", <RoadmapPage key="roadmap" />, "Workboard", "Roadmap module"],
    ["/canvas", <CanvasPage key="canvas" />, "Canvas", "Canvas module"],
    ["/agents", <AgentsPage key="agents" />, "Agents", "Agents module"],
    ["/settings", <SettingsPage key="settings" />, "Settings", "Settings module"],
  ])("renders %s as a shell-native module route", (pathname, page, title, content) => {
    mockedPathname = pathname;

    const html = renderRoute(page);

    expect(html).toContain("Product Suite");
    expect(html).toContain(title);
    expect(html).toContain(content);
    expect(html).toContain('aria-current="page"');
  });

  it.each([
    ["/w/acme", <WorkspaceHomePage key="home" />, "Product Suite", "Home"],
    ["/w/acme/workboard", <WorkspaceWorkboardPage key="workboard" />, "Workboard", "Roadmap module"],
    ["/w/acme/meetings", <WorkspaceMeetingsPage key="workspace-meetings" />, "Meetings", "Meeting module"],
    [
      "/w/acme/meetings/meeting_123",
      <WorkspaceMeetingPathPage key="workspace-meeting-path" />,
      "Meetings",
      "Meeting module",
    ],
    ["/w/acme/canvas", <WorkspaceCanvasPage key="workspace-canvas" />, "Canvas", "Canvas module"],
    ["/w/acme/agents", <WorkspaceAgentsPage key="workspace-agents" />, "Agents", "Agents module"],
    ["/w/acme/settings", <WorkspaceSettingsPage key="workspace-settings" />, "Settings", "Settings module"],
  ])("renders %s as a workspace-scoped platform route", (pathname, page, title, content) => {
    mockedPathname = pathname;

    const html = renderRoute(page);

    expect(html).toContain("Product Suite");
    expect(html).toContain(title);
    expect(html).toContain(content);
    expect(html).toContain('href="/w/acme/meetings"');
    expect(html).toContain('href="/w/acme/workboard"');
  });
});

function renderRoute(page: React.ReactNode) {
  return renderToStaticMarkup(<PlatformLayout>{page}</PlatformLayout>);
}
