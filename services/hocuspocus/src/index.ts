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
  return {
    ...context,
    canRead: Boolean(context.canRead),
    canWrite: Boolean(context.canWrite),
  };
}

export function resolveHocuspocusRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): HocuspocusRuntimeConfig {
  const rawPort = env.HOCUSPOCUS_PORT;
  const port = Number(rawPort);
  if (!rawPort || !Number.isInteger(port) || port <= 0) {
    throw new Error("HOCUSPOCUS_PORT must be a positive integer");
  }

  return {
    port,
    address: env.HOCUSPOCUS_ADDRESS,
    debounce: env.HOCUSPOCUS_DEBOUNCE_MS ? Number(env.HOCUSPOCUS_DEBOUNCE_MS) : 2000,
    maxDebounce: env.HOCUSPOCUS_MAX_DEBOUNCE_MS ? Number(env.HOCUSPOCUS_MAX_DEBOUNCE_MS) : 10000,
  };
}

export function createHocuspocusServerOptions(options: CreateHocuspocusServerOptions) {
  return {
    ...options.runtime,
    async onAuthenticate({ token, documentName }: { token: string; documentName: string }) {
      if (!options.verifyAuthToken) {
        throw new Error("Hocuspocus auth verifier is not configured");
      }
      return validateHocuspocusTokenContext(await options.verifyAuthToken({ token, documentName }));
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
      return options.loadDocument?.({ document, documentName, context });
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
      await options.storeDocument?.({ document, documentName, context: lastContext });
    },
  };
}
