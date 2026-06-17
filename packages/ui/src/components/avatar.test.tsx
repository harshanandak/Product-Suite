import { describe, expect, test } from "bun:test";

// Avatar is a Radix UI primitive whose image/fallback swap depends on a real
// DOM (image load events), so we smoke-test the module here and exercise its
// rendered behaviour in the app shell integration tests.
import * as Avatar from "./avatar";

describe("ui Avatar module", () => {
  test("loads and exposes defined exports", () => {
    const exports = Object.values(Avatar);
    expect(exports.length).toBeGreaterThan(0);
    for (const exported of exports) {
      expect(exported).toBeDefined();
    }
  });
});
