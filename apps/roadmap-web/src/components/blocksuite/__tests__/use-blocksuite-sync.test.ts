import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "../use-blocksuite-sync.ts"), "utf8");

describe("useBlockSuiteSync boundary wiring", () => {
  test("injects Supabase canvas boundaries into HybridProvider", () => {
    expect(source).toContain("createSupabaseCanvasBoundary");
    expect(source).toContain("const canvasBoundary = useMemo");
    expect(source).toContain("...canvasBoundary");
    const providerOptions = source.match(/new HybridProvider\(doc, \{([\s\S]*?)\n    \}\)/)?.[1] ?? "";
    expect(providerOptions).not.toContain("supabase");
  });
});
