// @product-suite/ui-chat — the suite chat package.
//
// Legacy surface (consumed by roadmap-web + meeting-web until Phase 2): the pure
// chat helpers, their shared types, and the hand-rolled ChatMessageList /
// ChatThreadList. AI Elements (vendored, oklch-tokened) + useWorkspaceChat are
// added alongside in the following sub-steps and re-exported here.

export {
  getChatMessageText,
  sortChatThreadsByUpdatedAt,
  createChatRecordId,
  formatChatTimestamp,
} from "./lib/chat-helpers";
export type {
  ChatMessage,
  ChatThread,
  ChatMessagePart,
  ChatToolInvocation,
} from "./lib/chat-helpers";

export { ChatMessageList } from "./components/chat-message-list";
export type { ChatMessageListProps } from "./components/chat-message-list";
export { ChatThreadList } from "./components/chat-thread-list";
export type { ChatThreadListProps } from "./components/chat-thread-list";
