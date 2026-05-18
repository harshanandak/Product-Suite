import { ChatMessageList } from "@product-suite/ui-chat";

export function ChatPanel({ messages = [] }) {
  return (
    <ChatMessageList
      messages={messages}
      className="rounded-[1.75rem] border border-white/8 bg-[linear-gradient(180deg,rgba(35,28,42,0.94),rgba(22,18,27,0.98))] p-5"
    />
  );
}
