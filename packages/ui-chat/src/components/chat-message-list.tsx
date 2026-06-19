import { getChatMessageText, type ChatMessage } from "../lib/chat-helpers";

export interface ChatMessageListProps {
  messages?: ChatMessage[];
  title?: string;
  emptyLabel?: string;
  className?: string;
}

function roleLabel(role?: string): string {
  return role || "message";
}

export function ChatMessageList({
  messages = [],
  title = "Discussion Chat",
  emptyLabel = "No messages yet.",
  className = "",
}: ChatMessageListProps) {
  const hasMessages = messages.length > 0;

  return (
    <section className={className}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-foreground/55">
        {title}
      </div>
      {hasMessages ? (
        <div className="mt-4 space-y-0 border-t border-white/8">
          {messages.map((message, index) => (
            <div
              key={message.id || index}
              className="border-b border-white/8 py-4 text-sm text-foreground/90"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-foreground/55">
                {roleLabel(message.role)}
              </div>
              <div className="mt-2 whitespace-pre-wrap leading-7">
                {getChatMessageText(message)}
              </div>
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
