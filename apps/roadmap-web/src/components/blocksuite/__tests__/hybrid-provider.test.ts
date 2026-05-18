import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "../hybrid-provider.ts"), "utf8");

describe("HybridProvider canvas boundary", () => {
  test("depends on injected canvas boundary interfaces instead of Supabase", () => {
    expect(source).toContain("CanvasPersistenceAdapter");
    expect(source).toContain("CanvasRealtimeAdapter");
    expect(source).toContain("CanvasMetadataStore");
    expect(source).toContain("this.persistence.saveState");
    expect(source).toContain("this.metadata.updateMetadata");
    expect(source).toContain("this.realtime.connect");
    expect(source).not.toContain("@supabase/supabase-js");
    expect(source).not.toContain(".from('blocksuite_documents')");
    expect(source).not.toContain(".channel(`blocksuite-");
  });
});
