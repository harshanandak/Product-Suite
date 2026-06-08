import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { createAppRouter, meetingRouteCompatibility } from "../app/router";

function renderPath(pathname) {
  const router = createMemoryRouter(createAppRouter(), {
    initialEntries: [pathname],
  });

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("frontend route pages", () => {
  test("renders the public landing page at root", () => {
    const html = renderPath("/");
    expect(html).toContain("Meet the night shift.");
    expect(html).toContain("Sign in to workspace");
  });

  test("renders the dedicated sign-in page", () => {
    const html = renderPath("/auth/sign-in");
    expect(html).toContain("Sign in");
    expect(html).toContain("Google");
  });

  test("renders the dedicated signed-out page", () => {
    const html = renderPath("/auth/signed-out");
    expect(html).toContain("Session closed");
    expect(html).toContain("You are signed out.");
    expect(html).toContain("Return to sign-in");
    expect(html).toContain("Back to landing page");
  });

  test("renders the dashboard home route", () => {
    const html = renderPath("/app");
    expect(html).toContain("Dashboard");
    expect(html).toContain("Recent meetings");
  });

  test("renders the meetings index route", () => {
    const html = renderPath("/meetings");
    expect(html).not.toContain("TRANSCRIBE");
    expect(html).toContain("MEETING AGENT");
    expect(html).toContain("Loading meetings...");
    expect(html).toContain("Preparing recent meetings, search, and open threads.");
    expect(html).toContain("Meeting history");
  });

  test("renders the meeting create route", () => {
    const html = renderPath("/meetings/new");
    expect(html).toContain("Preparing meeting setup...");
    expect(html).toContain("Loading meeting setup, transcription providers, and capture controls.");
    expect(html).toContain("Start a meeting");
  });

  test("renders the meeting workspace route", () => {
    const html = renderPath("/meetings/demo-meeting");
    expect(html).toContain("Opening meeting workspace...");
    expect(html).toContain("Restoring the selected meeting, transcript, summary, and action panels.");
    expect(html).toContain("Focused workspace");
  });

  test("documents standalone routes and platform shell compatibility", () => {
    expect(createAppRouter().map((route) => route.path)).toEqual([
      "/",
      "/auth/sign-in",
      "/auth/callback",
      "/auth/signed-out",
      "/app",
      "/meetings",
      "/meetings/new",
      "/meetings/:meetingId",
    ]);
    expect(meetingRouteCompatibility).toEqual({
      standaloneBasePath: "/",
      platformShellBasePath: "/meetings",
      shellOwnedEntryPath: "/meetings",
      runtimeOwner: "meeting-web",
      dataOwner: "meeting-api",
      preservesStandaloneRoutes: true,
    });
  });
});
