import { describe, expect, test } from "bun:test";
import type { Doc } from "yjs";

import { startHocuspocusRuntime, type HocuspocusReadinessStatus } from "./runtime";

const writableContext = {
  userId: "user-1",
  teamId: "team-1",
  documentId: "doc-1",
  canRead: true,
  canWrite: true,
};

describe("hocuspocus runtime entrypoint", () => {
  test("starts an injected server after validating runtime config", async () => {
    class RecordingServer {
      listenCalls = 0;

      constructor(public readonly options: Record<string, unknown>) {}

      listen() {
        this.listenCalls += 1;
        return this;
      }
    }

    const server = await startHocuspocusRuntime({
      env: {
        HOCUSPOCUS_PORT: "4123",
        HOCUSPOCUS_ADDRESS: "127.0.0.1",
        HOCUSPOCUS_DEBOUNCE_MS: "25",
        HOCUSPOCUS_MAX_DEBOUNCE_MS: "50",
      },
      verifyAuthToken() {
        return writableContext;
      },
      loadDocument({ document }: { document: Doc }) {
        return document;
      },
      storeDocument() {},
      ServerImplementation: RecordingServer,
    });

    expect(server).toBeInstanceOf(RecordingServer);
    expect(server.listenCalls).toBe(1);
    expect(server.options).toMatchObject({
      port: 4123,
      address: "127.0.0.1",
      debounce: 25,
      maxDebounce: 50,
    });
  });

  test("rejects invalid runtime config before constructing or listening", async () => {
    let constructed = false;

    class RecordingServer {
      constructor() {
        constructed = true;
      }

      listen() {
        throw new Error("listen should not be called");
      }
    }

    await expect(
      startHocuspocusRuntime({
        env: {
          HOCUSPOCUS_PORT: "",
        },
        verifyAuthToken() {
          return writableContext;
        },
        ServerImplementation: RecordingServer,
      }),
    ).rejects.toThrow(/HOCUSPOCUS_PORT/);
    expect(constructed).toBe(false);
  });

  test("reports pre-listen and healthy runtime readiness without sensitive inputs", async () => {
    class RecordingServer {
      constructor(public readonly options: Record<string, unknown>) {}

      listen() {
        return this;
      }
    }

    const readinessStatuses: HocuspocusReadinessStatus[] = [];

    await startHocuspocusRuntime({
      env: {
        HOCUSPOCUS_PORT: "4124",
        HOCUSPOCUS_ADDRESS: "127.0.0.1",
        HOCUSPOCUS_TOKEN: "secret-token",
        DOCUMENT_ID: "doc-secret",
      },
      verifyAuthToken() {
        return {
          ...writableContext,
          documentId: "doc-secret",
        };
      },
      ServerImplementation: RecordingServer,
      onReadinessChange(status) {
        readinessStatuses.push(status);
      },
    });

    expect(readinessStatuses).toEqual([
      {
        service: "hocuspocus",
        ready: false,
        status: "starting",
        runtime: {
          port: 4124,
          address: "127.0.0.1",
        },
      },
      {
        service: "hocuspocus",
        ready: true,
        status: "ready",
        runtime: {
          port: 4124,
          address: "127.0.0.1",
        },
      },
    ]);
    const serializedStatuses = JSON.stringify(readinessStatuses);
    expect(serializedStatuses).not.toContain("secret-token");
    expect(serializedStatuses).not.toContain("doc-secret");
    expect(serializedStatuses).not.toContain("canWrite");
  });
});
