import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

import {
  HOCUSPOCUS_SERVICE_NAME,
  createHocuspocusDocumentName,
  createHocuspocusServerOptions,
  resolveHocuspocusRuntimeConfig,
  validateHocuspocusTokenContext,
} from "./index";

describe("hocuspocus service registration", () => {
  test("exposes the realtime transport service name", () => {
    expect(HOCUSPOCUS_SERVICE_NAME).toBe("hocuspocus");
  });

  test("creates canonical document names from validated canvas identities", () => {
    expect(
      createHocuspocusDocumentName({
        teamId: "team-1",
        documentId: "doc_2",
      }),
    ).toBe("canvas:team-1:doc_2");

    expect(() =>
      createHocuspocusDocumentName({
        teamId: "../team",
        documentId: "doc-2",
      }),
    ).toThrow(/Invalid teamId/);
  });

  test("validates auth token context and runtime config", () => {
    expect(
      validateHocuspocusTokenContext({
        userId: "user-1",
        teamId: "team-1",
        documentId: "doc-1",
        canRead: true,
        canWrite: false,
      }),
    ).toEqual({
      userId: "user-1",
      teamId: "team-1",
      documentId: "doc-1",
      canRead: true,
      canWrite: false,
    });
    expect(() => validateHocuspocusTokenContext({ userId: "", teamId: "team-1", documentId: "doc-1" })).toThrow(
      /Invalid userId/,
    );
    expect(() => resolveHocuspocusRuntimeConfig({ HOCUSPOCUS_PORT: "" })).toThrow(
      /HOCUSPOCUS_PORT/,
    );
    expect(resolveHocuspocusRuntimeConfig({ HOCUSPOCUS_PORT: "1234" })).toMatchObject({
      port: 1234,
      debounce: 2000,
      maxDebounce: 10000,
    });
    expect(
      resolveHocuspocusRuntimeConfig({
        HOCUSPOCUS_PORT: "1234",
        HOCUSPOCUS_DEBOUNCE_MS: "25",
        HOCUSPOCUS_MAX_DEBOUNCE_MS: "50",
      }),
    ).toMatchObject({
      debounce: 25,
      maxDebounce: 50,
    });
    expect(() =>
      resolveHocuspocusRuntimeConfig({
        HOCUSPOCUS_PORT: "1234",
        HOCUSPOCUS_DEBOUNCE_MS: "slow",
      }),
    ).toThrow(/HOCUSPOCUS_DEBOUNCE_MS/);
    expect(() =>
      resolveHocuspocusRuntimeConfig({
        HOCUSPOCUS_PORT: "1234",
        HOCUSPOCUS_DEBOUNCE_MS: "100",
        HOCUSPOCUS_MAX_DEBOUNCE_MS: "50",
      }),
    ).toThrow(/HOCUSPOCUS_MAX_DEBOUNCE_MS/);
  });

  test("wires server hooks through injected auth, load, and store dependencies", async () => {
    const calls: string[] = [];
    const loadedDoc = new Y.Doc();
    loadedDoc.getMap("content").set("value", "loaded");
    const options = createHocuspocusServerOptions({
      runtime: { port: 1234, debounce: 10, maxDebounce: 20 },
      async verifyAuthToken(input) {
        calls.push(`auth:${input.token}:${input.documentName}`);
        return {
          userId: "user-1",
          teamId: "team-1",
          documentId: "doc-1",
          canRead: true,
          canWrite: true,
        };
      },
      async loadDocument(input) {
        calls.push(`load:${input.documentName}:${input.context.userId}`);
        return loadedDoc;
      },
      async storeDocument(input) {
        calls.push(`store:${input.documentName}:${input.context.userId}`);
      },
    });

    const context = await options.onAuthenticate?.({
      token: "token-1",
      documentName: "canvas:team-1:doc-1",
      context: {},
    } as never);
    const document = await options.onLoadDocument?.({
      document: new Y.Doc(),
      documentName: "canvas:team-1:doc-1",
      context,
    } as never);
    await options.onStoreDocument?.({
      document: document as Y.Doc,
      documentName: "canvas:team-1:doc-1",
      lastContext: context,
    } as never);

    expect(document).toBe(loadedDoc);
    expect(calls).toEqual([
      "auth:token-1:canvas:team-1:doc-1",
      "load:canvas:team-1:doc-1:user-1",
      "store:canvas:team-1:doc-1:user-1",
    ]);
    expect(options.port).toBe(1234);
  });

  test("enforces read and write permissions before load and store delegation", async () => {
    const calls: string[] = [];
    const options = createHocuspocusServerOptions({
      runtime: { port: 1234 },
      async loadDocument() {
        calls.push("load");
      },
      async storeDocument() {
        calls.push("store");
      },
    });

    const readOnlyContext = {
      userId: "user-1",
      teamId: "team-1",
      documentId: "doc-1",
      canRead: true,
      canWrite: false,
    };
    const writeOnlyContext = {
      ...readOnlyContext,
      canRead: false,
      canWrite: true,
    };

    await expect(
      options.onLoadDocument?.({
        document: new Y.Doc(),
        documentName: "canvas:team-1:doc-1",
        context: writeOnlyContext,
      } as never),
    ).rejects.toThrow(/read access denied/);
    await expect(
      options.onChange?.({
        document: new Y.Doc(),
        documentName: "canvas:team-1:doc-1",
        update: new Uint8Array([1]),
        context: readOnlyContext,
      } as never),
    ).rejects.toThrow(/write access denied/);
    await expect(
      options.onStoreDocument?.({
        document: new Y.Doc(),
        documentName: "canvas:team-1:doc-1",
        lastContext: readOnlyContext,
      } as never),
    ).rejects.toThrow(/write access denied/);
    await options.onLoadDocument?.({
      document: new Y.Doc(),
      documentName: "canvas:team-1:doc-1",
      context: readOnlyContext,
    } as never);
    await options.onChange?.({
      document: new Y.Doc(),
      documentName: "canvas:team-1:doc-1",
      update: new Uint8Array([1]),
      context: writeOnlyContext,
    } as never);
    await options.onStoreDocument?.({
      document: new Y.Doc(),
      documentName: "canvas:team-1:doc-1",
      lastContext: writeOnlyContext,
    } as never);

    expect(calls).toEqual(["load", "store"]);
  });
});
