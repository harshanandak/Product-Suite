import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DashboardView } from "../dashboard-view";

vi.mock("@/components/dashboard/mode-aware-dashboard", () => ({
  ModeAwareDashboard: () => <div>Mode dashboard</div>,
}));

describe("DashboardView", () => {
  it("mounts the shared meeting surface in the mode-aware dashboard", () => {
    const html = renderToStaticMarkup(
      <DashboardView
        workspace={{
          id: "workspace-1",
          name: "Launch Workspace",
          description: null,
          team_id: "team-1",
          mode: "development",
          phase: "development",
          created_at: "2026-05-18T00:00:00.000Z",
          updated_at: "2026-05-18T00:00:00.000Z",
          ai_memory: null,
          color: "#0f172a",
          custom_instructions: null,
          enabled_modules: [],
          icon: null,
          mode_changed_at: null,
          mode_settings: null,
          public_feedback_enabled: false,
          user_id: "user-1",
          voting_settings: null,
          widget_settings: null,
          workflow_config: null,
          workflow_mode_enabled: false,
        }}
        team={{
          id: "team-1",
          name: "Team",
          owner_id: "user-1",
          created_at: "2026-05-18T00:00:00.000Z",
          plan: "free",
        }}
        workItems={[]}
        teamSize={1}
        phaseDistribution={{
          design: { count: 0, percentage: 0 },
          build: { count: 0, percentage: 0 },
          refine: { count: 0, percentage: 0 },
          launch: { count: 0, percentage: 0 },
        }}
        onboardingState={{
          hasWorkItems: false,
          hasMindMaps: false,
          hasTimeline: false,
          hasDependencies: false,
          teamSize: 1,
          completionPercentage: 100,
        }}
      />,
    );

    expect(html).toContain("Mode dashboard");
    expect(html).toContain("Shared meeting block");
    expect(html).toContain("Launch Workspace");
  });
});
