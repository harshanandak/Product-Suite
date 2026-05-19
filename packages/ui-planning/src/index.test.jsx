import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PlanningSummaryBlock,
  getPlanningItemTitle,
  groupTimelineItemsByPhase,
  sortPlanningItemsByPriority,
} from "./index.jsx";

describe("ui-planning shared planning block", () => {
  test("renders planning records and a stable empty state without shell coupling", () => {
    const html = renderToStaticMarkup(
      <PlanningSummaryBlock
        title="Launch Plan"
        items={[
          {
            id: "work-1",
            title: "Ship authentication",
            status: "in_progress",
            priority: "high",
            timelinePhase: "MVP",
          },
        ]}
      >
        <span>Composed planning footer</span>
      </PlanningSummaryBlock>,
    );
    const emptyHtml = renderToStaticMarkup(<PlanningSummaryBlock title="Launch Plan" items={[]} />);

    expect(html).toContain("Launch Plan");
    expect(html).toContain("Ship authentication");
    expect(html).toContain("in progress");
    expect(html).toContain("high");
    expect(html).toContain("MVP");
    expect(html).toContain("Composed planning footer");
    expect(emptyHtml).toContain("No planning items yet.");
  });

  test("groups timeline records by normalized phase without mutating caller-owned arrays", () => {
    const timelineItems = [
      { id: "2", title: "Later", phase: "LONG" },
      { id: "1", title: "Launch", phase: "mvp" },
      { id: "3", title: "Unknown", phase: "someday" },
      { id: "4", title: "Roadmap short", timeline_phase: "SHORT" },
    ];
    const originalOrder = timelineItems.map((item) => item.id);

    expect(groupTimelineItemsByPhase(timelineItems)).toEqual({
      MVP: [timelineItems[1]],
      SHORT: [timelineItems[3]],
      LONG: [timelineItems[0]],
      UNASSIGNED: [timelineItems[2]],
    });
    expect(timelineItems.map((item) => item.id)).toEqual(originalOrder);
  });

  test("renders Roadmap snake_case timeline phases", () => {
    const html = renderToStaticMarkup(
      <PlanningSummaryBlock
        title="Roadmap Plan"
        items={[{ id: "roadmap-1", title: "Scope beta", timeline_phase: "SHORT" }]}
      />,
    );

    expect(html).toContain("Scope beta");
    expect(html).toContain("SHORT");
  });

  test("exports deterministic planning helpers", () => {
    const items = [
      { id: "low", title: "Low", priority: "low" },
      { id: "critical", title: "Critical", priority: "critical" },
      { id: "missing", name: "", priority: "unknown" },
    ];

    expect(sortPlanningItemsByPriority(items).map((item) => item.id)).toEqual([
      "critical",
      "low",
      "missing",
    ]);
    expect(items.map((item) => item.id)).toEqual(["low", "critical", "missing"]);
    expect(getPlanningItemTitle(items[0])).toBe("Low");
    expect(getPlanningItemTitle(items[2])).toBe("Untitled planning item");
  });
});
