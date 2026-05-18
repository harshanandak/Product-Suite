export type CanvasDocumentType = "mindmap" | "document" | "canvas";
export type CanvasEditorMode = "page" | "edgeless";

export interface CanvasIdentity {
  teamId: string;
  documentId: string;
}

export interface CanvasStorageResult {
  success: boolean;
  size?: number;
  error?: string;
}

export interface CanvasPersistenceAdapter {
  saveState(identity: CanvasIdentity, state: Uint8Array): Promise<CanvasStorageResult>;
  loadState(identity: CanvasIdentity): Promise<Uint8Array | null>;
  deleteState?(identity: CanvasIdentity): Promise<boolean>;
}

export interface CanvasMetadataUpdate {
  sizeBytes: number;
  syncVersion: number;
}

export interface CanvasMetadataStore {
  updateMetadata(identity: CanvasIdentity, metadata: CanvasMetadataUpdate): Promise<boolean>;
}

export interface CanvasRealtimePayload {
  update: string;
  documentId: string;
  origin?: string;
}

export interface CanvasRealtimeHandlers {
  onUpdate: (payload: unknown) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface CanvasRealtimeConnection {
  sendUpdate(payload: CanvasRealtimePayload): void | Promise<void>;
  destroy(): void | Promise<void>;
}

export interface CanvasRealtimeAdapter {
  connect(identity: CanvasIdentity, handlers: CanvasRealtimeHandlers): CanvasRealtimeConnection;
}

export interface CanvasBoundary {
  persistence: CanvasPersistenceAdapter;
  metadata: CanvasMetadataStore;
  realtime: CanvasRealtimeAdapter;
}

export const CANVAS_STORAGE_BUCKET = "blocksuite-yjs" as const;
export const DEFAULT_CANVAS_SYNC_DEBOUNCE_MS = 2000;

const SAFE_CANVAS_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

let lastTimestamp = -1;
let sequence = 0;

export function isValidCanvasId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && SAFE_CANVAS_ID_REGEX.test(id);
}

export function assertCanvasIdentity(identity: CanvasIdentity): CanvasIdentity {
  if (!isValidCanvasId(identity.teamId)) {
    throw new Error(`Invalid teamId: ${identity.teamId}`);
  }
  if (!isValidCanvasId(identity.documentId)) {
    throw new Error(`Invalid documentId: ${identity.documentId}`);
  }
  return identity;
}

export function createCanvasStoragePath(identity: CanvasIdentity): string {
  const safeIdentity = assertCanvasIdentity(identity);
  return `${safeIdentity.teamId}/${safeIdentity.documentId}.yjs`;
}

export function resolveCanvasEditorMode(documentType: CanvasDocumentType = "mindmap"): CanvasEditorMode {
  return documentType === "document" ? "page" : "edgeless";
}

export function createCanvasRecordId(now = Date.now): string {
  const timestamp = Number(now());
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("createCanvasRecordId: now() must return a finite number");
  }

  if (timestamp === lastTimestamp) {
    sequence += 1;
  } else {
    lastTimestamp = timestamp;
    sequence = 0;
  }

  return `${timestamp}-${sequence}`;
}

export function createCanvasBoundary(boundary: CanvasBoundary): CanvasBoundary {
  return boundary;
}
