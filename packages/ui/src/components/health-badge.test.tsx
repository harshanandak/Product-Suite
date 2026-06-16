import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HealthBadge, HEALTH_LABELS, type Health } from "./health-badge";

describe("HealthBadge", () => {
  const cases: Array<{ health: Health; label: string }> = [
    { health: "on_track", label: "On track" },
    { health: "at_risk", label: "At risk" },
    { health: "blocked", label: "Blocked" },
  ];

  for (const { health, label } of cases) {
    test(`renders the "${label}" label and data-health for ${health}`, () => {
      const html = renderToStaticMarkup(<HealthBadge health={health} />);

      expect(html).toContain(label);
      expect(html).toContain(`data-health="${health}"`);
    });
  }

  test("exposes correct HEALTH_LABELS mapping", () => {
    expect(HEALTH_LABELS).toEqual({
      on_track: "On track",
      at_risk: "At risk",
      blocked: "Blocked",
    });
  });

  test("forwards extra props and merges custom className", () => {
    const html = renderToStaticMarkup(
      <HealthBadge health="on_track" className="custom-class" title="health" />,
    );

    expect(html).toContain("custom-class");
    expect(html).toContain('title="health"');
  });
});
