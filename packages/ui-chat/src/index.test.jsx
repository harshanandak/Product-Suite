import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChatMessageList,
  ChatThreadList,
  createChatRecordId,
  formatChatTimestamp,
  getChatMessageText,
  sortChatThreadsByUpdatedAt,
} from "../dist/index.js";

describe("ui-chat shared chat block", () => {
  test("renders messages with content, parts fallback, and empty state", () => {
    const html = renderToStaticMarkup(
      <ChatMessageList
        messages={[
          { id: "m1", role: "assistant", content: "Direct answer" },
          { id: "m2", role: "user", content: null, parts: [{ type: "text", text: "Part answer" }] },
        ]}
      />,
    );
    const emptyHtml = renderToStaticMarkup(<ChatMessageList messages={[]} />);

    expect(html).toContain("Discussion Chat");
    expect(html).toContain("assistant");
    expect(html).toContain("Direct answer");
    expect(html).toContain("Part answer");
    expect(emptyHtml).toContain("No messages yet.");
  });

  test("renders thread controls and disables them without a shell handler", () => {
    const threads = [
      { id: "older", title: "Older", updated_at: "2026-05-17T10:00:00Z" },
      { id: "newer", title: "Newer", updated_at: "2026-05-18T10:00:00Z" },
    ];
    const readOnlyHtml = renderToStaticMarkup(
      <ChatThreadList
        threads={threads}
        selectedThreadId="newer"
        formatDate={(timestamp) => `formatted ${timestamp}`}
      />,
    );
    const wiredHtml = renderToStaticMarkup(<ChatThreadList threads={threads} onSelectThread={() => {}} />);

    expect(readOnlyHtml).toContain("Newer");
    expect(readOnlyHtml).toContain("formatted 2026-05-18T10:00:00Z");
    expect(readOnlyHtml).not.toContain(">2026-05-18T10:00:00Z<");
    expect(readOnlyHtml).toContain("disabled=\"\"");
    expect(wiredHtml).not.toContain("disabled=\"\"");
  });

  test("exports pure chat record helpers", () => {
    const threads = [
      { id: "older", updated_at: "2026-05-17T10:00:00Z" },
      { id: "newer", updated_at: "2026-05-18T10:00:00Z" },
    ];

    expect(getChatMessageText({ content: "primary", parts: [{ type: "text", text: "fallback" }] })).toBe("primary");
    expect(getChatMessageText({ content: null, parts: [{ type: "text", text: "fallback" }] })).toBe("fallback");
    expect(sortChatThreadsByUpdatedAt(threads).map((thread) => thread.id)).toEqual(["newer", "older"]);
    expect(threads.map((thread) => thread.id)).toEqual(["older", "newer"]);
    expect(createChatRecordId(() => 12345)).toBe("12345-0");
    expect(createChatRecordId(() => 12345)).toBe("12345-1");
    expect(() => createChatRecordId(() => Number.NaN)).toThrow(TypeError);
    expect(formatChatTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatChatTimestamp(0)).not.toBe("");
    expect(formatChatTimestamp(null)).toBe("");
  });
});
