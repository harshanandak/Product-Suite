import type { ReactNode } from "react";

export interface ChatMessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ChatToolInvocation {
  toolName: string;
  state: string;
  args?: unknown;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  parts: ChatMessagePart[] | null;
  tool_invocations: ChatToolInvocation[] | null;
  model_used: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatThread {
  id: string;
  team_id: string;
  workspace_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  status: "active" | "archived" | "deleted";
}

export interface ChatMessageListProps {
  messages?: ChatMessage[];
  title?: string;
  emptyLabel?: string;
  className?: string;
}

export interface ChatThreadListProps {
  threads?: ChatThread[];
  selectedThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  emptyLabel?: string;
  className?: string;
  formatDate?: (timestamp: string) => string;
}

export function getChatMessageText(message?: ChatMessage | null): string;
export function sortChatThreadsByUpdatedAt<T extends ChatThread>(threads?: T[]): T[];
export function createChatRecordId(now?: () => number): string;
export function formatChatTimestamp(timestamp?: string | number | null): string;
export function ChatMessageList(props: ChatMessageListProps): ReactNode;
export function ChatThreadList(props: ChatThreadListProps): ReactNode;
