import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "../simple-canvas.tsx"), "utf8");

describe("SimpleCanvas shell boundary wiring", () => {
  test("creates roadmap Supabase adapters but uses shared editor mode helper", () => {
    expect(source).toContain("createRoadmapCanvasBoundary");
    expect(source).not.toContain("createSupabaseCanvasBoundary(supabase)");
    expect(source).toContain("resolveCanvasEditorMode");
    expect(source).toContain("...canvasBoundary");
    expect(source).not.toContain("documentType === 'document' ? 'page' : 'edgeless'");
  });
});
