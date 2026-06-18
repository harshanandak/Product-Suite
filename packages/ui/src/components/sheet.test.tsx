import { describe, expect, test } from "bun:test";

// Sheet is a Radix UI Dialog portal/context primitive that requires a browser
// environment to render, so we smoke-test the module here and exercise its
// behaviour in the app shell integration tests.
import * as Sheet from "./sheet";

describe("ui Sheet module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Sheet);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
