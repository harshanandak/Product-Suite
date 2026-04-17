import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SummaryFirstMeetingScreen } from "../components/meeting/SummaryFirstMeetingScreen";

describe("summary-first meeting screen", () => {
  test("renders key sections, generated draft labels, promoted labels, and provenance", () => {
    const html = renderToStaticMarkup(
      <SummaryFirstMeetingScreen
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
              items: [
                {
                  id: "action-1",
                  text: "Send customer note",
                  record_origin: "generated",
                  review_status: "draft",
                  confidence: 0.58,
                },
              ],
            },
            {
              key: "openQuestions",
              items: [{ id: "question-1", text: "Who owns rollback?", record_origin: "generated", review_status: "draft" }],
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
          chatMessages: [{ id: "chat-1", role: "assistant", content: "Buddy history message" }],
        }}
        buddyResponse={{
          answer: "External guidance suggests a staged rollout.",
          sourceKind: "meeting+web",
          isStub: true,
          provenance: [
            { source: "current_meeting", detail: "meeting memory" },
            { source: "web", detail: "external guidance", url: "https://example.com" },
          ],
        }}
        onAskBuddy={() => {}}
        onStartRecording={() => {}}
        onPauseRecording={() => {}}
        onResumeRecording={() => {}}
        onStopRecording={() => {}}
      />
    );

    expect(html).toContain("Now");
    expect(html).toContain("Live Summary");
    expect(html).toContain("Decisions");
    expect(html).toContain("Open Questions");
    expect(html).toContain("Action Items");
    expect(html).toContain("Recent Lines");
    expect(html).toContain("Chapter Timeline");
    expect(html).toContain("Generated draft");
    expect(html).toContain("System promoted");
    expect(html).toContain("Confidence 94%");
    expect(html).toContain("Agreement and explicit acceptance detected");
    expect(html).toContain("Semantic boundary adjustment");
    expect(html).toContain("Preview");
    expect(html).toContain("Source provenance");
    expect(html).toContain("https://example.com");
  });

  test("renders the empty workspace state when no active meeting exists", () => {
    const html = renderToStaticMarkup(
      <SummaryFirstMeetingScreen
        meeting={null}
        summaryState={{}}
        onCreateMeeting={() => {}}
        onAskBuddy={() => {}}
        onStartRecording={() => {}}
        onPauseRecording={() => {}}
        onResumeRecording={() => {}}
        onStopRecording={() => {}}
      />
    );

    expect(html).toContain("Meetings workspace");
    expect(html).toContain("Create your first meeting.");
    expect(html).toContain("Create a meeting");
  });

  test("renders the chooser state when prior meeting history exists", () => {
    const html = renderToStaticMarkup(
      <SummaryFirstMeetingScreen
        meeting={null}
        hasMeetingHistory
        summaryState={{}}
        onCreateMeeting={() => {}}
        onAskBuddy={() => {}}
        onStartRecording={() => {}}
        onPauseRecording={() => {}}
        onResumeRecording={() => {}}
        onStopRecording={() => {}}
      />
    );

    expect(html).toContain("Choose a meeting to continue.");
    expect(html).toContain("Start a fresh meeting");
  });
});
