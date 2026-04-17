import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { AppShell } from "@/layouts/AppShell";

describe("AppShell", () => {
  test("renders the authenticated shell chrome", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AppShell
          workspaceName="Meeting Agent"
          pageTitle="Dashboard"
          pageDescription="Overview"
          userEmail="team@example.com"
          deploymentMode="hosted"
          activePath="/app"
          navItems={[
            { href: "/app", label: "Dashboard" },
            { href: "/meetings", label: "Meetings" },
          ]}
          onCreateMeeting={vi.fn()}
          onSearch={vi.fn()}
          onSettings={vi.fn()}
          onSignOut={vi.fn()}
        >
          <div>Body</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(html).toContain("Meeting Agent");
    expect(html).toContain("Dashboard");
    expect(html).toContain("team@example.com");
    expect(html).toContain("New meeting");
    expect(html).toContain("Body");
  });

  test("hides topbar actions when callbacks are not provided", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AppShell
          workspaceName="Meeting Agent"
          pageTitle="Dashboard"
          pageDescription="Overview"
          navItems={[{ href: "/app", label: "Dashboard" }]}
        >
          <div>Body</div>
        </AppShell>
      </MemoryRouter>
    );

    expect(html).not.toContain("Search");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Sign out");
  });
});
