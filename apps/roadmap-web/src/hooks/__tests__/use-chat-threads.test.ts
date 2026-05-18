import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(resolve(currentDir, "../use-chat-threads.ts"), "utf8");
const packageSource = readFileSync(
  resolve(currentDir, "../../../../../packages/ui-chat/src/index.jsx"),
  "utf8",
);
const packageBuild = readFileSync(
  resolve(currentDir, "../../../../../packages/ui-chat/dist/index.js"),
  "utf8",
);

describe("use-chat-threads shared package boundary", () => {
  test("uses shared chat helpers while keeping Supabase in the roadmap shell", () => {
    expect(hookSource).toContain("@product-suite/ui-chat");
    expect(hookSource).toContain("createChatRecordId");
    expect(hookSource).toContain("sortChatThreadsByUpdatedAt");
    expect(hookSource).toContain("prev.some((thread) => thread.id === incoming.id)");
    expect(hookSource).toContain("@/lib/supabase/client");
    expect(packageSource).not.toContain("@/lib/supabase/client");
    expect(packageSource).not.toContain("createClient");
    expect(packageSource).not.toContain("fetch(");
    expect(packageBuild).toContain("react/jsx-runtime");
    expect(packageBuild).not.toContain("react/jsx-dev-runtime");
    expect(packageBuild).not.toContain("jsxDEV");
  });
});
