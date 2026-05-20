import type { Doc } from "yjs";

import {
  createCanvasCollaborationRoomName,
  validateCanvasCollaborationIdentity,
  type CanvasIdentity,
  type CanvasCollaborationIdentity,
} from "@product-suite/ui-canvas";

export const HOCUSPOCUS_SERVICE_NAME = "hocuspocus";

export interface HocuspocusTokenContext extends CanvasCollaborationIdentity {
  canRead: boolean;
  canWrite: boolean;
}

export interface HocuspocusRuntimeConfig {
  port: number;
  address?: string;
  debounce?: number;
  maxDebounce?: number;
}

export interface HocuspocusHookInput {
  documentName: string;
  context: HocuspocusTokenContext;
}

export interface CreateHocuspocusServerOptions {
  runtime: HocuspocusRuntimeConfig;
  verifyAuthToken?: (input: {
    token: string;
    documentName: string;
  }) => Promise<HocuspocusTokenContext> | HocuspocusTokenContext;
  loadDocument?: (input: HocuspocusHookInput & { document: Doc }) => Promise<Doc | Uint8Array | null | void> | Doc | Uint8Array | null | void;
  storeDocument?: (input: HocuspocusHookInput & { document: Doc }) => Promise<void> | void;
}

export function createHocuspocusDocumentName(identity: CanvasIdentity): string {
  return createCanvasCollaborationRoomName(identity);
}

export function validateHocuspocusTokenContext(context: HocuspocusTokenContext): HocuspocusTokenContext {
  validateCanvasCollaborationIdentity(context);
  if (typeof context.canRead !== "boolean") {
    throw new Error("Invalid canRead: must be boolean");
  }
  if (typeof context.canWrite !== "boolean") {
    throw new Error("Invalid canWrite: must be boolean");
  }
  return {
    ...context,
  };
}

export function resolveHocuspocusRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): HocuspocusRuntimeConfig {
  const parsePositiveInt = (raw: string | undefined, key: string, fallback: number): number => {
    if (raw == null || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    return parsed;
  };

  const rawPort = env.HOCUSPOCUS_PORT;
  const port = Number(rawPort);
  if (!rawPort || !Number.isInteger(port) || port <= 0) {
    throw new Error("HOCUSPOCUS_PORT must be a positive integer");
  }

  const debounce = parsePositiveInt(env.HOCUSPOCUS_DEBOUNCE_MS, "HOCUSPOCUS_DEBOUNCE_MS", 2000);
  const maxDebounce = parsePositiveInt(env.HOCUSPOCUS_MAX_DEBOUNCE_MS, "HOCUSPOCUS_MAX_DEBOUNCE_MS", 10000);
  if (maxDebounce < debounce) {
    throw new Error("HOCUSPOCUS_MAX_DEBOUNCE_MS must be greater than or equal to HOCUSPOCUS_DEBOUNCE_MS");
  }

  return {
    port,
    address: env.HOCUSPOCUS_ADDRESS,
    debounce,
    maxDebounce,
  };
}

export function createHocuspocusServerOptions(options: CreateHocuspocusServerOptions) {
  return {
    ...options.runtime,
    async onAuthenticate({ token, documentName }: { token: string; documentName: string }) {
      if (!options.verifyAuthToken) {
        throw new Error("Hocuspocus auth verifier is not configured");
      }
      const context = validateHocuspocusTokenContext(await options.verifyAuthToken({ token, documentName }));
      if (createHocuspocusDocumentName(context) !== documentName) {
        throw new Error("Hocuspocus auth context does not match requested document");
      }
      return context;
    },
    async onLoadDocument({
      document,
      documentName,
      context,
    }: {
      document: Doc;
      documentName: string;
      context?: HocuspocusTokenContext;
    }) {
      if (!context) {
        throw new Error("Hocuspocus load context is missing");
      }
      if (!context.canRead) {
        throw new Error("Hocuspocus read access denied");
      }
      return options.loadDocument?.({ document, documentName, context });
    },
    async onChange({
      context,
    }: {
      document: Doc;
      documentName: string;
      update: Uint8Array;
      context?: HocuspocusTokenContext;
    }) {
      if (!context) {
        throw new Error("Hocuspocus change context is missing");
      }
      if (!context.canWrite) {
        throw new Error("Hocuspocus write access denied");
      }
    },
    async onStoreDocument({
      document,
      documentName,
      lastContext,
    }: {
      document: Doc;
      documentName: string;
      lastContext?: HocuspocusTokenContext;
    }) {
      if (!lastContext) {
        throw new Error("Hocuspocus store context is missing");
      }
      if (!lastContext.canWrite) {
        throw new Error("Hocuspocus write access denied");
      }
      await options.storeDocument?.({ document, documentName, context: lastContext });
    },
  };
}
