import { describe, expect, test } from "vitest";

import {
  BLOCKSUITE_STORAGE_BUCKET,
  DEFAULT_DEBOUNCE_MS,
  getStoragePath,
  isValidId,
} from "../persistence-types";

describe("BlockSuite persistence boundary aliases", () => {
  test("reuses shared canvas boundary constants and validation", () => {
    expect(BLOCKSUITE_STORAGE_BUCKET).toBe("blocksuite-yjs");
    expect(DEFAULT_DEBOUNCE_MS).toBe(2000);
    expect(isValidId("team-1_doc")).toBe(true);
    expect(isValidId("../team")).toBe(false);
    expect(getStoragePath("team-1", "doc_2")).toBe("team-1/doc_2.yjs");
  });
});
