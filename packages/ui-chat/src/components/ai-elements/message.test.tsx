import { describe, expect, test } from "bun:test";

import * as mod from "./message";

describe("ai-elements/message", () => {
  test("module loads and exports the Message surface", () => {
    expect(mod.Message).toBeDefined();
    expect(mod.MessageContent).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
