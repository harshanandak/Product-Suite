import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { HybridProvider } from "../hybrid-provider";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "../hybrid-provider.ts"), "utf8");

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function readSavedValue(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getMap("content").get("value");
}

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

  test("saves a follow-up state when edits happen during an in-flight save", async () => {
    const firstSave = createDeferred<{ success: boolean; size: number }>();
    const savedStates: Uint8Array[] = [];
    const saveState = vi.fn((_: unknown, state: Uint8Array) => {
      savedStates.push(state);
      if (savedStates.length === 1) {
        return firstSave.promise;
      }
      return Promise.resolve({ success: true, size: state.length });
    });
    const metadata = {
      updateMetadata: vi.fn().mockResolvedValue(true),
    };
    const doc = new Y.Doc();
    const provider = new HybridProvider(doc, {
      documentId: "doc-1",
      teamId: "team-1",
      persistence: {
        saveState,
        loadState: vi.fn().mockResolvedValue(null),
      },
      metadata,
      realtime: {
        connect: vi.fn(() => ({
          sendUpdate: vi.fn(),
          destroy: vi.fn(),
        })),
      },
      debounceMs: 10_000,
    });

    doc.getMap("content").set("value", "first");
    const pendingSave = provider.save();
    await Promise.resolve();
    expect(saveState).toHaveBeenCalledTimes(1);

    doc.getMap("content").set("value", "second");
    await provider.save();
    expect(saveState).toHaveBeenCalledTimes(1);

    firstSave.resolve({ success: true, size: savedStates[0].length });
    await pendingSave;

    expect(saveState).toHaveBeenCalledTimes(2);
    expect(readSavedValue(savedStates[1])).toBe("second");
    expect(metadata.updateMetadata).toHaveBeenCalledTimes(2);

    provider.destroy();
  });
});
