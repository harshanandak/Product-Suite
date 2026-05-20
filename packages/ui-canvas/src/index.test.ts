import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CANVAS_STORAGE_BUCKET,
  DEFAULT_CANVAS_SYNC_DEBOUNCE_MS,
  assertCanvasIdentity,
  createCanvasBoundary,
  createCanvasCollaborationRoomName,
  createCanvasRecordId,
  createCanvasStoragePath,
  isValidCanvasId,
  resolveCanvasEditorMode,
  validateCanvasCollaborationIdentity,
} from "./index";

const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

describe("ui-canvas boundary package", () => {
  test("exports pure canvas identity and storage helpers", () => {
    expect(CANVAS_STORAGE_BUCKET).toBe("blocksuite-yjs");
    expect(DEFAULT_CANVAS_SYNC_DEBOUNCE_MS).toBe(2000);
    expect(isValidCanvasId("team-123_canvas")).toBe(true);
    expect(isValidCanvasId("../team")).toBe(false);
    expect(() => assertCanvasIdentity({ teamId: "../team", documentId: "doc-1" })).toThrow(
      /Invalid teamId/,
    );
    expect(createCanvasStoragePath({ teamId: "team-1", documentId: "doc_2" })).toBe(
      "team-1/doc_2.yjs",
    );
  });

  test("keeps editor mode and record id helpers reusable", () => {
    expect(resolveCanvasEditorMode("document")).toBe("page");
    expect(resolveCanvasEditorMode("mindmap")).toBe("edgeless");
    expect(resolveCanvasEditorMode("canvas")).toBe("edgeless");
    expect(createCanvasRecordId(() => 123)).toBe("123-0");
    expect(createCanvasRecordId(() => 123)).toBe("123-1");
    expect(createCanvasRecordId(() => 122)).toBe("123-2");
    expect(() => createCanvasRecordId(() => Number.NaN)).toThrow(TypeError);
  });

  test("defines an injectable boundary without app runtime dependencies", async () => {
    const calls: string[] = [];
    const boundary = createCanvasBoundary({
      persistence: {
        async saveState(identity, state) {
          calls.push(`save:${identity.documentId}:${state.length}`);
          return { success: true, size: state.length };
        },
        async loadState(identity) {
          calls.push(`load:${identity.documentId}`);
          return new Uint8Array([1, 2, 3]);
        },
      },
      metadata: {
        async updateMetadata(identity, metadata) {
          calls.push(`metadata:${identity.teamId}:${metadata.syncVersion}`);
          return true;
        },
      },
      realtime: {
        connect(identity, handlers) {
          calls.push(`connect:${identity.documentId}`);
          handlers.onConnectionChange?.(true);
          return {
            sendUpdate(payload) {
              calls.push(`send:${payload.documentId}`);
            },
            destroy() {
              calls.push("destroy");
            },
          };
        },
      },
    });

    const identity = { teamId: "team-1", documentId: "doc-1" };
    await boundary.persistence.saveState(identity, new Uint8Array([1, 2]));
    await boundary.persistence.loadState(identity);
    await boundary.metadata.updateMetadata(identity, { sizeBytes: 2, syncVersion: 1 });
    const connection = boundary.realtime.connect(identity, {
      onUpdate: () => {},
      onConnectionChange: (connected) => calls.push(`connected:${connected}`),
    });
    await connection.sendUpdate({ update: "abc", documentId: "doc-1", origin: "local" });
    connection.destroy();

    expect(calls).toEqual([
      "save:doc-1:2",
      "load:doc-1",
      "metadata:team-1:1",
      "connect:doc-1",
      "connected:true",
      "send:doc-1",
      "destroy",
    ]);
    expect(source).not.toContain("@supabase");
    expect(source).not.toContain("next/");
    expect(source).not.toContain("@blocksuite");
  });

  test("defines canonical realtime collaboration identities and room names", () => {
    const identity = validateCanvasCollaborationIdentity({
      teamId: "team-1",
      documentId: "doc_2",
      userId: "user-3",
    });

    expect(identity).toEqual({
      teamId: "team-1",
      documentId: "doc_2",
      userId: "user-3",
    });
    expect(createCanvasCollaborationRoomName(identity)).toBe("canvas:team-1:doc_2");
    expect(() =>
      validateCanvasCollaborationIdentity({
        teamId: "team-1",
        documentId: "../doc",
        userId: "user-3",
      }),
    ).toThrow(/Invalid documentId/);
    expect(() =>
      validateCanvasCollaborationIdentity({
        teamId: "team-1",
        documentId: "doc-2",
        userId: "",
      }),
    ).toThrow(/Invalid userId/);
  });

  test("allows realtime adapters to receive an optional document binding", () => {
    const documentRef = { guid: "doc-guid-1" };
    const calls: unknown[] = [];
    const boundary = createCanvasBoundary({
      persistence: {
        async saveState() {
          return { success: true };
        },
        async loadState() {
          return null;
        },
      },
      metadata: {
        async updateMetadata() {
          return true;
        },
      },
      realtime: {
        connect(identity, handlers, options) {
          calls.push(identity, handlers, options?.document);
          return {
            sendUpdate() {},
            destroy() {},
          };
        },
      },
    });

    const identity = { teamId: "team-1", documentId: "doc-1" };
    boundary.realtime.connect(
      identity,
      {
        onUpdate: () => {},
      },
      { document: documentRef },
    );

    expect(calls).toEqual([
      identity,
      expect.objectContaining({ onUpdate: expect.any(Function) }),
      documentRef,
    ]);
    expect(source).toContain("CanvasRealtimeConnectionOptions");
    expect(source).toContain("document?: unknown");
  });
});
