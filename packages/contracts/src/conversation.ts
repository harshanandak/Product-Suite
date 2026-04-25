export const conversationContract = {
  module: "conversation",
  thread: {
    table: "chat_threads",
    idKey: "id",
    workspaceIdKey: "workspace_id",
    teamIdKey: "team_id",
    titleKey: "title",
    statusKey: "status",
    metadataKey: "metadata",
    createdAtKey: "created_at",
    updatedAtKey: "updated_at",
    createdByKey: "created_by",
  },
  message: {
    table: "chat_messages",
    idKey: "id",
    threadIdKey: "thread_id",
    roleKey: "role",
    contentKey: "content",
    partsKey: "parts",
    metadataKey: "metadata",
    toolInvocationsKey: "tool_invocations",
    modelUsedKey: "model_used",
    createdAtKey: "created_at",
  },
} as const;

export type ConversationContract = typeof conversationContract;
