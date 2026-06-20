// @product-suite/ui-chat — the suite chat package.
//
// Legacy surface (consumed by roadmap-web + meeting-web until Phase 2): the pure
// chat helpers, their shared types, and the hand-rolled ChatMessageList /
// ChatThreadList. Vendored AI Elements (oklch-tokened) live under
// ./components/ai-elements/* and are intentionally NOT re-exported from this
// root barrel — see the note below.

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

// Vendored Vercel AI Elements (Apache-2.0), retokened to our oklch primitives,
// live under ./components/ai-elements/*. They are intentionally NOT re-exported
// from this root barrel: doing so would pull the heavy ai/streamdown graph into
// legacy consumers (meeting-web/roadmap-web) that only need the chat helpers.
// The new app imports them by subpath, e.g.
//   import { Conversation } from "@product-suite/ui-chat/components/ai-elements/conversation";
