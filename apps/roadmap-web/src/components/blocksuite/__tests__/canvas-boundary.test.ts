import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSupabaseCanvasBoundary, selectRoadmapRealtimeAdapter } from "../canvas-boundary";

const currentDir = dirname(fileURLToPath(import.meta.url));
const hybridProviderSource = readFileSync(resolve(currentDir, "../hybrid-provider.ts"), "utf8");
const boundarySource = readFileSync(resolve(currentDir, "../canvas-boundary.ts"), "utf8");

function createMockSupabase() {
  const calls: string[] = [];
  const channel = {
    on(_type: string, _filter: unknown, callback: (message: { payload: unknown }) => void) {
      calls.push("channel:on");
      callback({ payload: { update: "abc", documentId: "doc-1", origin: "remote" } });
      return channel;
    },
    subscribe(callback: (status: string) => void) {
      calls.push("channel:subscribe");
      callback("SUBSCRIBED");
      return channel;
    },
    send(message: { payload: { documentId: string } }) {
      calls.push(`channel:send:${message.payload.documentId}`);
    },
  };

  const supabase = {
    calls,
    storage: {
      from(bucket: string) {
        calls.push(`storage:${bucket}`);
        return {
          async upload(path: string, state: Uint8Array) {
            calls.push(`upload:${path}:${state.length}`);
            return { error: null };
          },
          async download(path: string) {
            calls.push(`download:${path}`);
            return { data: new Blob([new Uint8Array([1, 2])]), error: null };
          },
        };
      },
    },
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        update(metadata: unknown) {
          calls.push(`update:${Object.keys(metadata as Record<string, unknown>).join(",")}`);
          return {
            eq() {
              return this;
            },
            select() {
              calls.push("select:id");
              return Promise.resolve({ data: [{ id: "doc-1" }], error: null });
            },
          };
        },
      };
    },
    channel(name: string) {
      calls.push(`channel:${name}`);
      return channel;
    },
    removeChannel() {
      calls.push("channel:remove");
    },
  };

  return supabase;
}

describe("canvas boundary adapters", () => {
  test("keeps Supabase in the roadmap adapter and out of HybridProvider", () => {
    expect(boundarySource).toContain("@supabase/supabase-js");
    expect(boundarySource).toContain("@product-suite/ui-canvas");
    expect(boundarySource).toContain("@product-suite/hocuspocus");
    expect(boundarySource).toContain("createHocuspocusDocumentName");
    expect(boundarySource).not.toContain(".channel(`blocksuite-");
    expect(hybridProviderSource).not.toContain("@supabase/supabase-js");
    expect(hybridProviderSource).toContain("CanvasPersistenceAdapter");
    expect(hybridProviderSource).toContain("CanvasRealtimeAdapter");
    expect(hybridProviderSource).toContain("CanvasMetadataStore");
  });

  test("adapts Supabase storage, metadata, and realtime to canvas boundaries", async () => {
    const supabase = createMockSupabase();
    const boundary = createSupabaseCanvasBoundary(supabase as never);
    const identity = { teamId: "team-1", documentId: "doc-1" };

    await boundary.persistence.saveState(identity, new Uint8Array([1, 2, 3]));
    const loaded = await boundary.persistence.loadState(identity);
    const metadataUpdated = await boundary.metadata.updateMetadata(identity, {
      sizeBytes: 3,
      syncVersion: 2,
    });
    const connection = boundary.realtime.connect(identity, {
      onUpdate: (payload) => supabase.calls.push(`update:${(payload as { documentId: string }).documentId}`),
      onConnectionChange: (connected) => supabase.calls.push(`connected:${connected}`),
    });
    await connection.sendUpdate({ update: "abc", documentId: "doc-1", origin: "local" });
    connection.destroy();

    expect(loaded).toEqual(new Uint8Array([1, 2]));
    expect(metadataUpdated).toBe(true);
    expect(supabase.calls).toContain("storage:blocksuite-yjs");
    expect(supabase.calls).toContain("upload:team-1/doc-1.yjs:3");
    expect(supabase.calls).toContain("download:team-1/doc-1.yjs");
    expect(supabase.calls).toContain("from:blocksuite_documents");
    expect(supabase.calls).toContain("channel:canvas:team-1:doc-1");
    expect(supabase.calls).toContain("connected:true");
    expect(supabase.calls).toContain("update:doc-1");
    expect(supabase.calls).toContain("channel:send:doc-1");
    expect(supabase.calls).toContain("channel:remove");
  });

  test("selects Hocuspocus realtime when service URL and token factory are configured", async () => {
    const supabase = createMockSupabase();
    const calls: string[] = [];
    const realtime = selectRoadmapRealtimeAdapter({
      supabase: supabase as never,
      hocuspocusUrl: "https://hocuspocus.example.com",
      createAuthToken(identity) {
        calls.push(`token:${identity.teamId}:${identity.documentId}`);
        return "token-1";
      },
      createHocuspocusConnection({ url, documentName, token, handlers }) {
        calls.push(`connect:${url}:${documentName}:${token}`);
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
    });

    const connection = realtime.connect(
      { teamId: "team-1", documentId: "doc-1" },
      {
        onUpdate: () => calls.push("update"),
        onConnectionChange: (connected) => calls.push(`connected:${connected}`),
      },
    );

    await connection.sendUpdate({ update: "abc", documentId: "doc-1", origin: "local" });
    connection.destroy();

    expect(calls).toEqual([
      "token:team-1:doc-1",
      "connect:https://hocuspocus.example.com:canvas:team-1:doc-1:token-1",
      "connected:true",
      "send:doc-1",
      "destroy",
    ]);
    expect(supabase.calls).not.toContain("channel:canvas:team-1:doc-1");
  });

  test("passes Hocuspocus selection config through the canvas boundary factory", () => {
    const supabase = createMockSupabase();
    const calls: string[] = [];
    const boundary = createSupabaseCanvasBoundary(supabase as never, {
      hocuspocusUrl: "https://hocuspocus.example.com",
      createAuthToken(identity) {
        calls.push(`token:${identity.teamId}:${identity.documentId}`);
        return "token-1";
      },
      createHocuspocusConnection({ documentName }) {
        calls.push(`connect:${documentName}`);
        return {
          sendUpdate(payload) {
            calls.push(`send:${payload.documentId}`);
          },
          destroy() {
            calls.push("destroy");
          },
        };
      },
    });

    const connection = boundary.realtime.connect(
      { teamId: "team-1", documentId: "doc-1" },
      {
        onUpdate: () => calls.push("update"),
      },
    );
    connection.sendUpdate({ update: "abc", documentId: "doc-1", origin: "local" });
    connection.destroy();

    expect(calls).toEqual(["token:team-1:doc-1", "connect:canvas:team-1:doc-1", "send:doc-1", "destroy"]);
    expect(supabase.calls).not.toContain("channel:canvas:team-1:doc-1");
  });

  test("rejects empty Hocuspocus auth tokens before creating a connection", () => {
    const supabase = createMockSupabase();
    const realtime = selectRoadmapRealtimeAdapter({
      supabase: supabase as never,
      hocuspocusUrl: "https://hocuspocus.example.com",
      createAuthToken() {
        return "   ";
      },
      createHocuspocusConnection() {
        throw new Error("connection should not be created");
      },
    });

    expect(() =>
      realtime.connect(
        { teamId: "team-1", documentId: "doc-1" },
        {
          onUpdate: () => supabase.calls.push("update"),
        },
      ),
    ).toThrow(/auth token/);
  });

  test("falls back to Supabase realtime when Hocuspocus URL is missing", () => {
    const supabase = createMockSupabase();
    const realtime = selectRoadmapRealtimeAdapter({
      supabase: supabase as never,
      hocuspocusUrl: "",
      createAuthToken() {
        return "token-1";
      },
    });

    const connection = realtime.connect(
      { teamId: "team-1", documentId: "doc-1" },
      {
        onUpdate: () => supabase.calls.push("update"),
      },
    );
    connection.destroy();

    expect(supabase.calls).toContain("channel:canvas:team-1:doc-1");
    expect(supabase.calls).toContain("channel:remove");
  });

  test("falls back to Supabase realtime when token factory is missing", () => {
    const supabase = createMockSupabase();
    const realtime = selectRoadmapRealtimeAdapter({
      supabase: supabase as never,
      hocuspocusUrl: "https://hocuspocus.example.com",
    });

    const connection = realtime.connect(
      { teamId: "team-1", documentId: "doc-1" },
      {
        onUpdate: () => supabase.calls.push("update"),
      },
    );
    connection.destroy();

    expect(supabase.calls).toContain("channel:canvas:team-1:doc-1");
    expect(supabase.calls).toContain("channel:remove");
  });
});
