import { describe, expect, test } from "bun:test";

import * as mod from "./conversation";

// Smoke test: importing exercises the whole vendored module graph (our
// @product-suite/ui primitives + ai / use-stick-to-bottom), so a load failure
// surfaces any unresolved import or incompatible primitive.
describe("ai-elements/conversation", () => {
  test("module loads and exports the Conversation surface", () => {
    expect(mod.Conversation).toBeDefined();
    expect(mod.ConversationContent).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
