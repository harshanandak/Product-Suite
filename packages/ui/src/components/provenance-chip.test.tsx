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

  test("shows the source label once (no sr-only duplicate) when no custom label is given", () => {
    const html = renderToStaticMarkup(
      createElement(ProvenanceChip, { source: "agent" }),
    );
    expect(html).toContain("Agent");
    // The fallback must not also emit the sr-only prefix, otherwise screen
    // readers announce the source twice (e.g. "Agent: Agent").
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("Agent: ");
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

  // Regression-lock (Rank 20 Wave B, item 1 — "drop redundant source tooltip"):
  // the chip is SELF-DESCRIBING — it renders its source as visible text, so it
  // needs no hover Tooltip to surface the source. Lock that the chip emits no
  // tooltip-trigger plumbing of its own (no Radix tooltip slot/state, no native
  // `title`, no `aria-describedby`), so a consumer never needs to wrap it in a
  // Tooltip just to convey the source. Audited as already-implemented in this
  // shared component; the only redundant Tooltip wrappers live in app consumers
  // (out of scope for packages/ui — see task deviations).
  test("is self-describing: visible source text and no tooltip trigger plumbing", () => {
    const html = renderToStaticMarkup(
      createElement(ProvenanceChip, { source: "manual" }),
    );
    // The source reads as visible text — the reason a tooltip is redundant.
    expect(html).toContain("Manual");
    // No tooltip wiring emitted by the chip itself.
    expect(html).not.toContain('data-slot="tooltip-trigger"');
    expect(html).not.toContain("data-state=");
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("title=");
    expect(html).not.toContain('role="tooltip"');
  });
});
