import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PriorityBadge,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  type Priority,
} from "./priority-badge";

describe("Priority enum + labels", () => {
  test("PRIORITY_ORDER is the four priorities, highest → lowest", () => {
    expect(PRIORITY_ORDER).toEqual(["critical", "high", "medium", "low"]);
  });

  test("PRIORITY_LABELS has a human label for every priority", () => {
    expect(PRIORITY_LABELS).toEqual({
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
    });
  });
});

describe("PriorityBadge", () => {
  test("renders the label and a data-priority hook for each priority", () => {
    for (const priority of PRIORITY_ORDER) {
      const html = renderToStaticMarkup(
        createElement(PriorityBadge, { priority }),
      );
      expect(html).toContain(`data-priority="${priority}"`);
      expect(html).toContain(PRIORITY_LABELS[priority]);
    }
  });

  test("shows an icon for critical and high, none for medium and low", () => {
    const withIcon: Priority[] = ["critical", "high"];
    const withoutIcon: Priority[] = ["medium", "low"];
    for (const priority of withIcon) {
      const html = renderToStaticMarkup(
        createElement(PriorityBadge, { priority }),
      );
      expect(html).toContain("<svg");
    }
    for (const priority of withoutIcon) {
      const html = renderToStaticMarkup(
        createElement(PriorityBadge, { priority }),
      );
      expect(html).not.toContain("<svg");
    }
  });

  test("merges a custom className and forwards span attributes", () => {
    const html = renderToStaticMarkup(
      createElement(PriorityBadge, {
        priority: "high",
        className: "ml-2",
        title: "Priority",
      }),
    );
    expect(html).toContain("ml-2");
    expect(html).toContain('title="Priority"');
  });

  test("paints each level with its own chroma ramp, not a neutral surface", () => {
    for (const priority of PRIORITY_ORDER) {
      const html = renderToStaticMarkup(
        createElement(PriorityBadge, { priority }),
      );
      // Distinct, chroma-bearing surface + foreground per level (survives dark
      // mode) — never the overloaded neutral tokens that collapsed to gray.
      expect(html).toContain(`bg-priority-${priority}`);
      expect(html).toContain(`text-priority-${priority}-foreground`);
      for (const neutral of ["bg-muted", "bg-secondary", "bg-accent"]) {
        expect(html).not.toContain(neutral);
      }
    }
  });

  test("gives the icon-less levels a colored leading dot in the level hue", () => {
    // Belt-and-suspenders: medium/low have no glyph, so a chroma dot encodes
    // the level even if the surface reads low-contrast.
    for (const priority of ["medium", "low"] as Priority[]) {
      const html = renderToStaticMarkup(
        createElement(PriorityBadge, { priority }),
      );
      expect(html).toContain(`bg-priority-${priority}-foreground`);
      expect(html).toContain("rounded-full");
      expect(html).not.toContain("<svg");
    }
  });
});
