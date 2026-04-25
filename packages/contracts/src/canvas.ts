export const canvasCoreContract = {
  module: "canvas",
  document: {
    table: "blocksuite_documents",
    idKey: "id",
    workspaceIdKey: "workspace_id",
    teamIdKey: "team_id",
    documentTypeKey: "document_type",
    storagePathKey: "storage_path",
    storageSizeBytesKey: "storage_size_bytes",
    syncVersionKey: "sync_version",
    activeEditorsKey: "active_editors",
    lastSyncAtKey: "last_sync_at",
    titleKey: "title",
    createdAtKey: "created_at",
    updatedAtKey: "updated_at",
  },
} as const;

export type CanvasCoreContract = typeof canvasCoreContract;
