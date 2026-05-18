import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatPanel } from "../ChatPanel";

describe("ChatPanel", () => {
  test("renders meeting chat messages through the shared chat package", () => {
    const html = renderToStaticMarkup(
      <ChatPanel messages={[{ id: "message-1", role: "assistant", content: "Shared package message" }]} />,
    );

    expect(html).toContain("Discussion Chat");
    expect(html).toContain("assistant");
    expect(html).toContain("Shared package message");
  });
});
