import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SummaryFirstMeetingScreen } from "../SummaryFirstMeetingScreen";

describe("SummaryFirstMeetingScreen wrapper", () => {
  test("renders the shared meeting block with meeting-web shell slots", () => {
    const html = renderToStaticMarkup(
      <SummaryFirstMeetingScreen
        meeting={{ title: "Shell Wrapper Review" }}
        summaryState={{
          meetingState: {
            current_topic: "Wrapper",
            current_goal: "Delegate presentation to the shared package.",
          },
          sections: [
            { key: "decisions", items: [{ text: "Use ui-meeting", review_status: "promoted" }] },
          ],
          chatMessages: [{ id: "message-1", role: "assistant", content: "Meeting-web chat slot" }],
        }}
        buddyResponse={{ answer: "Meeting-web buddy slot" }}
        onAskBuddy={() => {}}
      />,
    );

    expect(html).toContain("Shell Wrapper Review");
    expect(html).toContain("Use ui-meeting");
    expect(html).toContain("Meeting-web buddy slot");
    expect(html).toContain("Meeting-web chat slot");
  });
});
