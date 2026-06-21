import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ProvenanceChip,
  WORK_ITEM_SOURCE_LABELS,
  type WorkItemSource,
} from "./provenance-chip";

const ALL_SOURCES: WorkItemSource[] = ["manual", "meeting", "agent", "feedback"];

describe("WorkItemSource enum + labels", () => {
  test("WORK_ITEM_SOURCE_LABELS covers the four sources", () => {
    expect(WORK_ITEM_SOURCE_LABELS).toEqual({
      manual: "Manual",
      meeting: "Meeting",
      agent: "Agent",
      feedback: "Feedback",
    });
  });
});

describe("ProvenanceChip", () => {
  test("renders a per-source icon and a data-source hook for each source", () => {
    for (const source of ALL_SOURCES) {
      const html = renderToStaticMarkup(
        createElement(ProvenanceChip, { source }),
      );
      expect(html).toContain(`data-source="${source}"`);
      expect(html).toContain("<svg");
    }
  });

  test("shows the source label when no custom label is given", () => {
    const html = renderToStaticMarkup(
      createElement(ProvenanceChip, { source: "agent" }),
    );
    expect(html).toContain("Agent");
  });

  test("shows the custom label, with the source name kept for screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(ProvenanceChip, {
        source: "meeting",
        label: "Weekly sync 28:51",
      }),
    );
    expect(html).toContain("Weekly sync 28:51");
    // Source name still announced (sr-only) so provenance is non-visual too.
    expect(html).toContain("Meeting");
    expect(html).toContain("sr-only");
  });
});
