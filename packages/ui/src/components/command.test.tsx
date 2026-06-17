import { describe, expect, test } from "bun:test";

// Command wraps cmdk + Radix Dialog (portals/context) and requires a browser
// environment to render, so we smoke-test the module here and exercise its
// behaviour in the app shell command-palette integration tests.
import * as Command from "./command";

describe("ui Command module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Command);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
