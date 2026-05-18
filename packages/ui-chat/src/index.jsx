import React from "react";

export function getChatMessageText(message = {}) {
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

export function sortChatThreadsByUpdatedAt(threads = []) {
  return [...threads].sort((first, second) => {
    const firstTime = Date.parse(first?.updated_at || first?.created_at || "");
    const secondTime = Date.parse(second?.updated_at || second?.created_at || "");
    return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
  });
}

export function createChatRecordId(now = Date.now) {
  return String(now());
}

function roleLabel(role) {
  return role || "message";
}

export function ChatMessageList({
  messages = [],
  title = "Discussion Chat",
  emptyLabel = "No messages yet.",
  className = "",
}) {
  const hasMessages = messages.length > 0;

  return (
    <section className={className}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">{title}</div>
      {hasMessages ? (
        <div className="mt-4 space-y-0 border-t border-white/8">
          {messages.map((message, index) => (
            <div key={message.id || index} className="border-b border-white/8 py-4 text-sm text-foreground/90">
              <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/55">
                {roleLabel(message.role)}
              </div>
              <div className="mt-2 whitespace-pre-wrap leading-7">{getChatMessageText(message)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 border-t border-white/8 py-4 text-sm leading-7 text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

export function ChatThreadList({
  threads = [],
  selectedThreadId = null,
  onSelectThread,
  emptyLabel = "No chat threads yet.",
  className = "",
}) {
  const sortedThreads = sortChatThreadsByUpdatedAt(threads);
  const canSelectThread = typeof onSelectThread === "function";

  return (
    <section className={className}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">Chat Threads</div>
      {sortedThreads.length > 0 ? (
        <div className="mt-3 space-y-2">
          {sortedThreads.map((thread) => {
            const isSelected = thread.id === selectedThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={canSelectThread ? () => onSelectThread(thread.id) : undefined}
                disabled={!canSelectThread}
                className={`w-full border px-3 py-2 text-left text-sm ${
                  isSelected ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="block font-medium text-foreground">{thread.title || "Untitled chat"}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{thread.updated_at || thread.created_at || ""}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 text-sm leading-7 text-muted-foreground">{emptyLabel}</div>
      )}
    </section>
  );
}
