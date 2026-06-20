import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatThreadList } from "./chat-thread-list";
import type { ChatThread } from "../lib/chat-helpers";

function thread(partial: Partial<ChatThread>): ChatThread {
  return {
    id: "t",
    team_id: "team",
    workspace_id: "ws",
    title: null,
    created_at: "2026-05-17T10:00:00Z",
    updated_at: "2026-05-17T10:00:00Z",
    metadata: {},
    created_by: null,
    status: "active",
    ...partial,
  };
}

describe("ChatThreadList", () => {
  const threads = [
    thread({ id: "older", title: "Older", updated_at: "2026-05-17T10:00:00Z" }),
    thread({ id: "newer", title: "Newer", updated_at: "2026-05-18T10:00:00Z" }),
  ];

  test("sorts newest-first, formats the timestamp, and disables without a handler", () => {
    const html = renderToStaticMarkup(
      <ChatThreadList
        threads={threads}
        selectedThreadId="newer"
        formatDate={(timestamp) => `formatted ${timestamp}`}
      />,
    );
    expect(html).toContain("Newer");
    expect(html).toContain("formatted 2026-05-18T10:00:00Z");
    expect(html).not.toContain(">2026-05-18T10:00:00Z<");
    expect(html).toContain('disabled=""');
  });

  test("enables the controls when a select handler is supplied", () => {
    const html = renderToStaticMarkup(
      <ChatThreadList threads={threads} onSelectThread={() => {}} />,
    );
    expect(html).not.toContain('disabled=""');
  });

  test("renders the empty state with no threads", () => {
    const html = renderToStaticMarkup(<ChatThreadList threads={[]} />);
    expect(html).toContain("No chat threads yet.");
  });
});
