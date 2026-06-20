// Pure chat helpers + shared chat types. Preserved verbatim (ported JS -> TS)
// because the legacy apps consume them: roadmap-web imports createChatRecordId /
// sortChatThreadsByUpdatedAt + the ChatMessage/ChatThread types; meeting-web
// renders ChatMessageList. Both die at Phase 2; until then this surface stays.

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

type MessageTextSource = {
  content?: string | null;
  parts?: ReadonlyArray<{ text?: unknown } | null | undefined> | null;
} | null;

export function getChatMessageText(message?: MessageTextSource): string {
  if (!message) {
    return "";
  }

  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

type SortableThread = { updated_at?: string; created_at?: string };

export function sortChatThreadsByUpdatedAt<T extends SortableThread>(
  threads: readonly T[] = [],
): T[] {
  return [...threads].sort((first, second) => {
    const firstTime = Date.parse(first?.updated_at || first?.created_at || "");
    const secondTime = Date.parse(second?.updated_at || second?.created_at || "");
    return (
      (Number.isNaN(secondTime) ? 0 : secondTime) -
      (Number.isNaN(firstTime) ? 0 : firstTime)
    );
  });
}

let lastTimestamp = -1;
let sequence = 0;

export function createChatRecordId(now: () => number = Date.now): string {
  const rawTimestamp = Number(now());
  if (!Number.isFinite(rawTimestamp)) {
    throw new TypeError("createChatRecordId: now() must return a finite number");
  }
  // Never let the clock move backward: a rollback would otherwise reset the
  // sequence and regenerate an id we already handed out (these ids are persisted
  // thread keys downstream). Monotonic timestamp + sequence keeps them unique.
  const timestamp = Math.max(rawTimestamp, lastTimestamp);

  if (timestamp === lastTimestamp) {
    sequence += 1;
  } else {
    lastTimestamp = timestamp;
    sequence = 0;
  }

  return `${timestamp}-${sequence}`;
}

export function formatChatTimestamp(
  timestamp?: string | number | null,
): string {
  if (timestamp == null || timestamp === "") {
    return "";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
