import { describe, expect, test } from "bun:test";

import {
  createChatRecordId,
  formatChatTimestamp,
  getChatMessageText,
  sortChatThreadsByUpdatedAt,
} from "./chat-helpers";

describe("chat-helpers", () => {
  test("getChatMessageText prefers content, falls back to text parts, else empty", () => {
    expect(
      getChatMessageText({ content: "primary", parts: [{ text: "fallback" }] }),
    ).toBe("primary");
    expect(
      getChatMessageText({ content: null, parts: [{ text: "fallback" }] }),
    ).toBe("fallback");
    expect(getChatMessageText({ content: "   ", parts: null })).toBe("");
    expect(getChatMessageText(null)).toBe("");
    expect(getChatMessageText()).toBe("");
  });

  test("sortChatThreadsByUpdatedAt sorts newest-first without mutating input", () => {
    const threads = [
      { id: "older", updated_at: "2026-05-17T10:00:00Z" },
      { id: "newer", updated_at: "2026-05-18T10:00:00Z" },
    ];
    expect(sortChatThreadsByUpdatedAt(threads).map((t) => t.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(threads.map((t) => t.id)).toEqual(["older", "newer"]);
  });

  test("createChatRecordId is monotonic per timestamp and rejects non-finite", () => {
    expect(createChatRecordId(() => 12345)).toBe("12345-0");
    expect(createChatRecordId(() => 12345)).toBe("12345-1");
    expect(createChatRecordId(() => 99999)).toBe("99999-0");
    expect(() => createChatRecordId(() => Number.NaN)).toThrow(TypeError);
  });

  test("formatChatTimestamp echoes unparseable input and blanks empty input", () => {
    expect(formatChatTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatChatTimestamp(0)).not.toBe("");
    expect(formatChatTimestamp(null)).toBe("");
    expect(formatChatTimestamp("")).toBe("");
  });
});
