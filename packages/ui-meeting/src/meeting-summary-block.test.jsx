import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MeetingSummaryBlock,
  formatConfidence,
  resolveStatusLabel,
} from "./meeting-summary-block.js";

describe("MeetingSummaryBlock source module", () => {
  test("renders the public shared meeting sections", () => {
    const html = renderToStaticMarkup(
      <MeetingSummaryBlock
        meeting={{ title: "Source Path Review" }}
        summaryState={{
          meetingState: {
            current_topic: "Extraction",
            current_goal: "Keep the block route-free.",
            summary_bullets: ["Shared UI package"],
          },
          sections: [
            { key: "decisions", items: [{ text: "Keep shell slots", review_status: "promoted" }] },
            { key: "actionItems", items: [{ text: "Validate package reuse" }] },
            { key: "openQuestions", items: [{ text: "Which shell owns persistence?" }] },
            { key: "chapters", items: [{ title: "Boundary", summary_text: "No router coupling." }] },
          ],
        }}
      />,
    );

    expect(html).toContain("Source Path Review");
    expect(html).toContain("Live Summary");
    expect(html).toContain("System promoted");
    expect(html).toContain("No router coupling.");
  });

  test("exports generated record helpers from the source module", () => {
    expect(formatConfidence(0.91)).toBe("Confidence 91%");
    expect(resolveStatusLabel({ review_status: "promoted" })).toBe("System promoted");
  });
});
