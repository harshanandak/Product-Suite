import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MeetingSummaryBlock,
  formatConfidence,
  resolveStatusLabel,
} from "./index.js";

describe("ui-meeting shared meeting summary block", () => {
  test("renders the reusable active meeting surface without shell coupling", () => {
    const html = renderToStaticMarkup(
      <MeetingSummaryBlock
        meeting={{ title: "Launch Review" }}
        summaryState={{
          meetingState: {
            current_topic: "Launch readiness",
            current_goal: "Confirm final blockers",
            summary_bullets: ["Decide ship date", "Review ownership"],
          },
          recentLines: [
            { speaker_label: "SPK 1", text: "We can ship next week.", timestamp_start: 1 },
            { speaker_label: "SPK 2", text: "One blocker remains.", timestamp_start: 2 },
          ],
          sections: [
            {
              key: "decisions",
              items: [
                {
                  id: "decision-1",
                  text: "Ship next week",
                  record_origin: "generated",
                  review_status: "promoted",
                  confidence: 0.94,
                  promotion_reason: "Agreement and explicit acceptance detected",
                },
              ],
            },
            {
              key: "actionItems",
              items: [{ id: "action-1", text: "Send customer note", confidence: 0.58 }],
            },
            {
              key: "openQuestions",
              items: [{ id: "question-1", text: "Who owns rollback?" }],
            },
            {
              key: "chapters",
              items: [
                {
                  id: "chapter-1",
                  title: "Minutes 0-5",
                  summary_text: "Discussed launch and blockers.",
                  boundary_source: "semantic_adjustment",
                  window_label: "0:00-5:00",
                },
              ],
            },
          ],
        }}
        buddySlot={<aside>Shell buddy slot</aside>}
        chatSlot={<aside>Shell chat slot</aside>}
      />,
    );

    expect(html).toContain("Launch Review");
    expect(html).toContain("Live Summary");
    expect(html).toContain("Decisions");
    expect(html).toContain("Open Questions");
    expect(html).toContain("Action Items");
    expect(html).toContain("Recent Lines");
    expect(html).toContain("Chapter Timeline");
    expect(html).toContain("System promoted");
    expect(html).toContain("Confidence 94%");
    expect(html).toContain("Semantic boundary adjustment");
    expect(html).toContain("Shell buddy slot");
    expect(html).toContain("Shell chat slot");
  });

  test("renders reusable empty and chooser states", () => {
    const firstMeetingHtml = renderToStaticMarkup(<MeetingSummaryBlock meeting={null} />);
    const chooserHtml = renderToStaticMarkup(
      <MeetingSummaryBlock meeting={null} hasMeetingHistory />,
    );

    expect(firstMeetingHtml).toContain("Create your first meeting.");
    expect(firstMeetingHtml).toContain("Create a meeting");
    expect(chooserHtml).toContain("Choose a meeting to continue.");
    expect(chooserHtml).toContain("Start a fresh meeting");
  });

  test("exports generated record helpers for app-level assertions", () => {
    expect(formatConfidence(0.58)).toBe("Confidence 58%");
    expect(formatConfidence(null)).toBe(null);
    expect(resolveStatusLabel({ review_status: "promoted" })).toBe("System promoted");
    expect(resolveStatusLabel({ review_status: "draft" })).toBe("Generated draft");
  });
});
