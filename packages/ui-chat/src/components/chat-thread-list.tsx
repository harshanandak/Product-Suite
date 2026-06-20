import {
  formatChatTimestamp,
  sortChatThreadsByUpdatedAt,
  type ChatThread,
} from "../lib/chat-helpers";

export interface ChatThreadListProps {
  threads?: ChatThread[];
  selectedThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
  emptyLabel?: string;
  className?: string;
  formatDate?: (timestamp: string) => string;
}

export function ChatThreadList({
  threads = [],
  selectedThreadId = null,
  onSelectThread,
  emptyLabel = "No chat threads yet.",
  className = "",
  formatDate = formatChatTimestamp,
}: Readonly<ChatThreadListProps>) {
  const sortedThreads = sortChatThreadsByUpdatedAt(threads);
  const canSelectThread = typeof onSelectThread === "function";

  return (
    <section className={className}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">
        Chat Threads
      </div>
      {sortedThreads.length > 0 ? (
        <div className="mt-3 space-y-2">
          {sortedThreads.map((thread) => {
            const isSelected = thread.id === selectedThreadId;
            const timestamp = thread.updated_at || thread.created_at || "";
            const timestampLabel = timestamp ? formatDate(timestamp) : "";
            return (
              <button
                key={thread.id}
                type="button"
                onClick={
                  canSelectThread ? () => onSelectThread(thread.id) : undefined
                }
                disabled={!canSelectThread}
                className={`w-full border px-3 py-2 text-left text-sm ${
                  isSelected
                    ? "border-primary/40 bg-primary/10"
                    : "border-white/10 bg-white/5"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="block font-medium text-foreground">
                  {thread.title || "Untitled chat"}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {timestampLabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 text-sm leading-7 text-muted-foreground">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}
