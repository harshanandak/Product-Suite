import { describe, expect, test } from "bun:test";

// ScrollArea is a Radix UI primitive whose scrollbars depend on a real DOM, so
// we smoke-test the module here and exercise its behaviour in the app shell
// integration tests.
import * as ScrollArea from "./scroll-area";

describe("ui ScrollArea module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(ScrollArea);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
