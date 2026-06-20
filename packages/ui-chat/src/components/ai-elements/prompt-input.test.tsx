import { describe, expect, test } from "bun:test";

import * as mod from "./prompt-input";

describe("ai-elements/prompt-input", () => {
  test("module loads and exports the PromptInput surface", () => {
    expect(mod.PromptInput).toBeDefined();
    expect(mod.PromptInputTextarea).toBeDefined();
    expect(mod.PromptInputSubmit).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
