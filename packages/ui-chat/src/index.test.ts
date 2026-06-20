import { describe, expect, test } from "bun:test";

import {
  ChatMessageList,
  ChatThreadList,
  createChatRecordId,
  formatChatTimestamp,
  getChatMessageText,
  sortChatThreadsByUpdatedAt,
} from "./index";

describe("@product-suite/ui-chat barrel", () => {
  test("re-exports the legacy public surface as callable values", () => {
    for (const exported of [
      getChatMessageText,
      sortChatThreadsByUpdatedAt,
      createChatRecordId,
      formatChatTimestamp,
      ChatMessageList,
      ChatThreadList,
    ]) {
      expect(exported).toBeDefined();
    }
    expect(typeof getChatMessageText).toBe("function");
    expect(typeof ChatMessageList).toBe("function");
  });
});
