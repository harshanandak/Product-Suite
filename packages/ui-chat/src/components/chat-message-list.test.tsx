import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatMessageList } from "./chat-message-list";
import type { ChatMessage } from "../lib/chat-helpers";

function message(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m",
    thread_id: "t",
    role: "assistant",
    content: null,
    parts: null,
    tool_invocations: null,
    model_used: null,
    metadata: {},
    created_at: "2026-05-18T10:00:00Z",
    ...partial,
  };
}

describe("ChatMessageList", () => {
  test("renders content, the text-parts fallback, and the role label", () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[
          message({ id: "m1", role: "assistant", content: "Direct answer" }),
          message({
            id: "m2",
            role: "user",
            content: null,
            parts: [{ type: "text", text: "Part answer" }],
          }),
        ]}
      />,
    );

    expect(html).toContain("Discussion Chat");
    expect(html).toContain("assistant");
    expect(html).toContain("Direct answer");
    expect(html).toContain("Part answer");
  });

  test("renders the empty state when there are no messages", () => {
    const html = renderToStaticMarkup(<ChatMessageList messages={[]} />);
    expect(html).toContain("No messages yet.");
  });
});
